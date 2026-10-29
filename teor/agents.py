"""Agentes de código (Claude Code, Codex, Cursor) como sistemas avaliados, sem acesso ao gabarito.

O agente só recebe o texto do prompt. O arquivo de prompts não contém gabarito, e cada chamada roda
em um diretório vazio, com ambiente reduzido e, quando pedido, sob um sandbox do sistema que nega a
leitura do repositório e dos dados. O Teor pontua depois, do lado confiável, com os itens completos.
"""

import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

from teor.io import digest, read_json, read_jsonl, write_json, write_jsonl
from teor.models import Item, Prediction
from teor.runner import PROMPT_FORMAT, SYSTEM, request_prompt
from teor.scoring import parse_response

PROMPT_KEYS = {"item_id", "variant", "track", "answer_type", "prompt", "prompt_format"}
ISOLATIONS = ("workdir", "sandbox-exec", "external")
PUBLISHABLE_ISOLATIONS = ("sandbox-exec", "external")
BASE_ENV = ("PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "TERM", "TMPDIR", "SHELL")
MCP_NAME = "teor"
MCP_TOOL = "snapshot_record"


def prompt_rows(items: list[Item]) -> list[dict[str, Any]]:
    """Projeção sem gabarito: o que o agente pode ver e o mínimo para casar a resposta ao item."""
    return [
        {
            "item_id": item.id,
            "variant": variant,
            "track": item.track,
            "answer_type": item.answer.type,
            "prompt": request_prompt(item, variant),
            "prompt_format": PROMPT_FORMAT,
        }
        for item in items
        for variant in range(len(item.prompts))
    ]


def load_prompts(path: Path) -> list[dict[str, Any]]:
    rows = read_jsonl(path)
    for row in rows:
        if set(row) != PROMPT_KEYS:
            raise ValueError(
                f"Arquivo de prompts com chaves inesperadas: {sorted(set(row) ^ PROMPT_KEYS)}"
            )
        if row["prompt_format"] != PROMPT_FORMAT:
            raise ValueError("Prompts preparados com outro formato de prompt; prepare de novo")
    if not rows:
        raise ValueError("Arquivo de prompts vazio")
    return rows


@dataclass
class Outcome:
    text: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float | None = None
    tool_calls: int = 0
    error: str | None = None
    resolved_model: str | None = None


@dataclass
class Adapter:
    binary: str
    tools_profile: str
    system_channel: str
    env_keys: tuple[str, ...]
    verified_live: bool
    build: Callable[..., list[str]]
    parse: Callable[[str, Path], Outcome]
    prompt_via_stdin: bool = True
    needs_outdir: bool = False
    extra: dict[str, Any] = field(default_factory=dict)


def _json_lines(stdout: str) -> list[dict[str, Any]]:
    rows = []
    for line in stdout.splitlines():
        line = line.strip()
        if line.startswith("{"):
            try:
                value = json.loads(line)
            except ValueError:
                continue
            if isinstance(value, dict):
                rows.append(value)
    return rows


def claude_build(
    model: str, api_url: str | None, workdir: Path, outdir: Path, sandboxed: bool
) -> list[str]:
    argv = [
        "claude",
        "-p",
        "--output-format",
        "json",
        "--model",
        model,
        "--no-session-persistence",
        "--disable-slash-commands",
        "--strict-mcp-config",
        "--setting-sources",
        "project",
        "--append-system-prompt",
        SYSTEM,
    ]
    if api_url:
        config = {
            "mcpServers": {
                MCP_NAME: {
                    "command": sys.executable,
                    "args": ["-m", "teor.agent_mcp", "--api-url", api_url],
                }
            }
        }
        argv += [
            "--mcp-config",
            json.dumps(config),
            "--tools",
            "",
            "--allowedTools",
            f"mcp__{MCP_NAME}__{MCP_TOOL}",
        ]
    else:
        argv += ["--tools", ""]
    return argv


def claude_parse(stdout: str, outdir: Path) -> Outcome:
    try:
        payload = json.loads(stdout)
    except ValueError:
        return Outcome(error="saída do Claude Code não é JSON")
    if isinstance(payload, list):
        payload = next((p for p in reversed(payload) if p.get("type") == "result"), {})
    if not isinstance(payload, dict) or payload.get("is_error") or "result" not in payload:
        return Outcome(error=f"Claude Code reportou erro: {str(payload.get('result', ''))[:200]}")
    usage = payload.get("usage") or {}
    return Outcome(
        text=str(payload["result"]),
        input_tokens=sum(
            usage.get(k, 0) or 0
            for k in ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")
        ),
        output_tokens=usage.get("output_tokens", 0) or 0,
        cost_usd=payload.get("total_cost_usd"),
        tool_calls=max(int(payload.get("num_turns", 1) or 1) - 1, 0),
        resolved_model=",".join(sorted(payload.get("modelUsage") or {})) or None,
    )


def codex_build(
    model: str, api_url: str | None, workdir: Path, outdir: Path, sandboxed: bool
) -> list[str]:
    argv = [
        "codex",
        "exec",
        "--json",
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
        "--skip-git-repo-check",
        "-C",
        str(workdir),
        "--output-last-message",
        str(outdir / "last.txt"),
        "-m",
        model,
    ]
    # O seatbelt do Codex não aninha dentro do sandbox do sistema: um dos dois isola.
    argv += ["--dangerously-bypass-approvals-and-sandbox"] if sandboxed else ["-s", "read-only"]
    if api_url:
        args = json.dumps(["-m", "teor.agent_mcp", "--api-url", api_url])
        argv += [
            "-c",
            f"mcp_servers.{MCP_NAME}.command={json.dumps(sys.executable)}",
            "-c",
            f"mcp_servers.{MCP_NAME}.args={args}",
        ]
    return argv + ["-"]


def codex_parse(stdout: str, outdir: Path) -> Outcome:
    last = outdir / "last.txt"
    out = Outcome()
    for event in _json_lines(stdout):
        kind = event.get("type")
        if kind == "turn.completed":
            usage = event.get("usage") or {}
            out.input_tokens += usage.get("input_tokens", 0) or 0
            out.output_tokens += usage.get("output_tokens", 0) or 0
        elif kind == "item.completed" and (event.get("item") or {}).get("type") in (
            "command_execution",
            "mcp_tool_call",
            "file_change",
        ):
            out.tool_calls += 1
        elif kind in ("error", "turn.failed"):
            out.error = str(event.get("message") or event.get("error") or kind)[:200]
    if last.exists():
        out.text = last.read_text(encoding="utf-8")
    elif not out.error:
        out.error = "Codex não gravou a última mensagem"
    return out


def cursor_build(
    model: str, api_url: str | None, workdir: Path, outdir: Path, sandboxed: bool
) -> list[str]:
    if api_url:
        (workdir / ".cursor").mkdir(exist_ok=True)
        (workdir / ".cursor" / "mcp.json").write_text(
            json.dumps(
                {
                    "mcpServers": {
                        MCP_NAME: {
                            "command": sys.executable,
                            "args": ["-m", "teor.agent_mcp", "--api-url", api_url],
                        }
                    }
                }
            )
        )
    return ["cursor-agent", "-p", "--output-format", "json", "--model", model, "--mode", "ask"]


def cursor_parse(stdout: str, outdir: Path) -> Outcome:
    for event in reversed(_json_lines(stdout)):
        if event.get("type") == "result" or "result" in event:
            if event.get("is_error"):
                return Outcome(error=f"Cursor reportou erro: {str(event.get('result'))[:200]}")
            return Outcome(text=str(event.get("result", "")))
    return Outcome(error="saída do Cursor sem resultado")


AGENTS: dict[str, Adapter] = {
    "claude": Adapter(
        binary="claude",
        tools_profile="sem ferramentas nativas (G: só snapshot_record por MCP)",
        system_channel="append-system-prompt",
        env_keys=("ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR"),
        verified_live=True,
        build=claude_build,
        parse=claude_parse,
    ),
    "codex": Adapter(
        binary="codex",
        tools_profile="shell em diretório vazio, sandbox de leitura (G: snapshot_record por MCP)",
        system_channel="prefixo do prompt",
        env_keys=("OPENAI_API_KEY", "CODEX_HOME"),
        verified_live=False,
        build=codex_build,
        parse=codex_parse,
        needs_outdir=True,
    ),
    "cursor": Adapter(
        binary="cursor-agent",
        tools_profile="modo ask (G: snapshot_record por MCP)",
        system_channel="prefixo do prompt",
        env_keys=("CURSOR_API_KEY",),
        verified_live=False,
        build=cursor_build,
        parse=cursor_parse,
        prompt_via_stdin=False,
    ),
}


def agent_version(name: str) -> str:
    binary = shutil.which(AGENTS[name].binary)
    if binary is None:
        raise ValueError(f"Agente não encontrado no PATH: {AGENTS[name].binary}")
    done = subprocess.run(
        [binary, "--version"], capture_output=True, text=True, timeout=30, env=scrubbed_env(name)
    )
    version = (done.stdout or done.stderr).strip().splitlines()
    if done.returncode != 0 or not version:
        raise ValueError(f"Não foi possível obter a versão de {name}")
    return version[0]


def scrubbed_env(name: str) -> dict[str, str]:
    """Credenciais do Teor, de provedores e do GitHub nunca chegam ao agente avaliado."""
    allowed = set(BASE_ENV) | set(AGENTS[name].env_keys)
    return {k: v for k, v in os.environ.items() if k in allowed}


def repo_roots() -> list[Path]:
    package = Path(__file__).resolve().parent
    roots = [package.parent, Path.cwd().resolve()]
    return [r for i, r in enumerate(roots) if r not in roots[:i]]


def sandbox_profile(deny: list[Path], allow: list[Path]) -> str:
    lines = ["(version 1)", "(allow default)"]
    lines += [f'(deny file-read* (subpath "{p}"))' for p in deny]
    lines += [f'(allow file-read* (subpath "{p}"))' for p in allow]
    return "".join(lines)


def sandbox_command(extra_deny: list[Path]) -> tuple[list[str], str, list[Path]]:
    if platform.system() != "Darwin" or shutil.which("sandbox-exec") is None:
        raise ValueError(
            "sandbox-exec só existe no macOS; em Linux ou CI use --isolation external em uma "
            "máquina sem o repositório nem os dados (ver docs/agentes.md)"
        )
    deny = [*repo_roots(), *(p.resolve() for p in extra_deny)]
    package = Path(__file__).resolve().parent
    # O interpretador e o pacote precisam ser legíveis para o servidor MCP da trilha G.
    allow = [Path(sys.prefix).resolve(), package]
    profile = sandbox_profile(deny, allow)
    return ["sandbox-exec", "-p", profile], profile, deny


def check_external_isolation() -> None:
    """Evidência mínima de que o gabarito não existe nesta máquina."""
    for root in repo_roots():
        for suspect in (
            root / "data" / "benchmark" / "private",
            root / "private",
            root / "published",
        ):
            if suspect.exists():
                raise ValueError(
                    f"--isolation external recusado: {suspect} existe nesta máquina. "
                    "Rode o agente em um ambiente sem o repositório e sem dados privados."
                )


def fresh_workdir() -> Path:
    path = Path(tempfile.mkdtemp(prefix="teor-agent-")).resolve()
    for root in repo_roots():
        if path == root or root in path.parents:
            shutil.rmtree(path, ignore_errors=True)
            raise ValueError(
                "TMPDIR aponta para dentro do repositório; o diretório do agente não seria isolado"
            )
    return path


def run_one(
    name: str,
    row: dict[str, Any],
    model: str,
    api_url: str | None,
    wrapper: list[str],
    timeout: int,
) -> tuple[Outcome, float, int]:
    adapter = AGENTS[name]
    workdir, outdir = fresh_workdir(), fresh_workdir()
    prompt = row["prompt"]
    if adapter.system_channel != "append-system-prompt":
        prompt = SYSTEM + "\n\n" + prompt
    argv = wrapper + adapter.build(
        model, api_url if row["track"] == "G" else None, workdir, outdir, bool(wrapper)
    )
    binary = shutil.which(adapter.binary)
    argv[len(wrapper)] = binary or adapter.binary
    if not adapter.prompt_via_stdin:
        argv.append(prompt)
    start = time.monotonic()
    try:
        done = subprocess.run(
            argv,
            input=prompt if adapter.prompt_via_stdin else None,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=workdir,
            env=scrubbed_env(name),
        )
        if done.returncode != 0:
            outcome = Outcome(
                error=f"saída {done.returncode}: {(done.stderr or done.stdout)[-200:]}"
            )
        else:
            outcome = adapter.parse(done.stdout, outdir)
    except subprocess.TimeoutExpired:
        outcome = Outcome(error=f"tempo esgotado ({timeout}s)")
    elapsed = time.monotonic() - start
    writes = sum(1 for _ in workdir.rglob("*") if ".cursor" not in _.parts)
    shutil.rmtree(workdir, ignore_errors=True)
    shutil.rmtree(outdir, ignore_errors=True)
    return outcome, elapsed, writes


def prediction(
    row: dict[str, Any],
    outcome: Outcome,
    elapsed: float,
    run_id: str,
    model: str,
    price: dict[str, Any] | None,
) -> Prediction:
    response, abstain, status = parse_response(outcome.text)
    if outcome.error:
        status = "infrastructure_error"
    cost = outcome.cost_usd
    if cost is None and price and not outcome.error:
        cost = (
            outcome.input_tokens * price["input_per_million"]
            + outcome.output_tokens * price["output_per_million"]
        ) / 1_000_000
    return Prediction(
        item_id=row["item_id"],
        variant=row["variant"],
        run_id=run_id,
        model=model,
        response=response,
        abstain=abstain,
        status=status,
        input_tokens=outcome.input_tokens,
        output_tokens=outcome.output_tokens,
        latency_seconds=elapsed,
        cost_usd=cost,
        tool_calls=outcome.tool_calls,
        error=outcome.error,
    )


def preflight_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    chosen: dict[tuple[str, str], dict[str, Any]] = {}
    for row in rows:
        if row["track"] != "G" and row["variant"] == 0:
            chosen.setdefault((row["track"], row["answer_type"]), row)
    return list(chosen.values())


def run_agent(
    rows: list[dict[str, Any]],
    agent: str,
    model: str,
    output: Path,
    budget: float,
    isolation: str = "workdir",
    api_url: str | None = None,
    concurrency: int = 1,
    timeout: int = 300,
    deny_read: list[Path] | None = None,
    price: dict[str, Any] | None = None,
    max_calls: int | None = None,
) -> list[Prediction]:
    if agent not in AGENTS:
        raise ValueError(f"Agente desconhecido: {agent}")
    if isolation not in ISOLATIONS:
        raise ValueError(f"Isolamento deve ser um de {ISOLATIONS}")
    if any(r["track"] == "G" for r in rows) and not api_url:
        raise ValueError("Trilha G exige --api-url (teor serve do snapshot congelado)")
    wrapper: list[str] = []
    profile = ""
    denied: list[Path] = []
    if isolation == "sandbox-exec":
        wrapper, profile, denied = sandbox_command(deny_read or [])
    elif isolation == "external":
        check_external_isolation()
    version = agent_version(agent)
    prompts_hash = digest(rows)
    run_id = digest(
        {
            "prompts": prompts_hash,
            "agent": agent,
            "model": model,
            "version": version,
            "prompt_format": PROMPT_FORMAT,
            "isolation": isolation,
            "api_url": api_url,
        }
    )[:24]
    label = f"agent/{agent}/{model}"
    previous = [Prediction.model_validate(p) for p in read_jsonl(output)] if output.exists() else []
    if any(p.run_id != run_id for p in previous):
        raise ValueError("Checkpoint pertence a outra configuração de agente")
    kept = [p for p in previous if p.status != "infrastructure_error"]
    done = {(p.item_id, p.variant) for p in kept}
    pending = [r for r in rows if (r["item_id"], r["variant"]) not in done]
    if max_calls is not None:
        pending = pending[:max_calls]
    spent = sum(p.cost_usd or 0 for p in kept)
    stats_path = output.with_suffix(".isolation.json")
    stats = (
        read_json(stats_path) if stats_path.exists() and kept else {"calls": 0, "workdir_writes": 0}
    )
    raw = (
        {(r["item_id"], r["variant"]): r for r in read_jsonl(output.with_suffix(".raw.jsonl"))}
        if output.with_suffix(".raw.jsonl").exists()
        else {}
    )
    result = list(kept)
    skipped = 0
    width = max(concurrency, 1)
    with ThreadPoolExecutor(max_workers=width) as pool:
        for start in range(0, len(pending), width):
            if spent >= budget:
                skipped = len(pending) - start
                break
            chunk = pending[start : start + width]
            runs = pool.map(lambda r: run_one(agent, r, model, api_url, wrapper, timeout), chunk)
            for row_done, (outcome, elapsed, writes) in zip(chunk, runs, strict=True):
                pred = prediction(row_done, outcome, elapsed, run_id, label, price)
                spent += pred.cost_usd or 0
                stats["calls"] += 1
                stats["workdir_writes"] += writes
                key = (pred.item_id, pred.variant)
                raw[key] = {
                    "item_id": pred.item_id,
                    "variant": pred.variant,
                    "completion": outcome.text,
                    "error": outcome.error,
                    "resolved_model": outcome.resolved_model,
                }
                result = [p for p in result if (p.item_id, p.variant) != key] + [pred]
            write_jsonl(output, result)
    write_jsonl(
        output.with_suffix(".raw.jsonl"),
        sorted(raw.values(), key=lambda r: (r["item_id"], r["variant"])),
    )
    adapter = AGENTS[agent]
    write_json(
        stats_path,
        {
            "agent": agent,
            "agent_version": version,
            "agent_model": model,
            "agent_model_resolved": sorted(
                {r.get("resolved_model") for r in raw.values() if r.get("resolved_model")}
            ),
            "agent_tools": adapter.tools_profile,
            "system_prompt_channel": adapter.system_channel,
            "adapter_verified_live": adapter.verified_live,
            "isolation": isolation,
            "env_passed": sorted(scrubbed_env(agent)),
            "sandbox_profile_sha256": digest(profile) if profile else None,
            "deny_read_paths": len(denied),
            "prompts_sha256": prompts_hash,
            "calls": stats["calls"],
            "workdir_writes": stats["workdir_writes"],
            "tool_calls": sum(p.tool_calls for p in result),
            "run_id": run_id,
        },
    )
    if skipped:
        raise ValueError(f"Orçamento de {budget} USD atingido; {skipped} chamadas pendentes")
    return result


def agent_config(output: Path) -> dict[str, Any]:
    """Config para `teor score --config`: copia o que a execução comprovou, sem preencher à mão."""
    stats = read_json(output.with_suffix(".isolation.json"))
    return {
        "model_classification": "agent",
        "agent": stats["agent"],
        "agent_version": stats["agent_version"],
        "agent_model": stats["agent_model"],
        "agent_model_resolved": stats.get("agent_model_resolved", []),
        "agent_tools": stats["agent_tools"],
        "system_prompt_channel": stats["system_prompt_channel"],
        "isolation": stats["isolation"],
        "isolation_attestation": {
            k: stats[k]
            for k in (
                "env_passed",
                "sandbox_profile_sha256",
                "deny_read_paths",
                "prompts_sha256",
                "calls",
                "workdir_writes",
                "tool_calls",
                "adapter_verified_live",
            )
        },
        "prompt_format": PROMPT_FORMAT,
        "parser": "tolerant-v1",
        "run_date": date.today().isoformat(),
        "temperature": "não controlável: definido pelo agente",
        "variants": 3,
        "reproduction": "teor agent prepare + teor agent run; ver docs/agentes.md",
    }


REQUIRED_AGENT_KEYS = (
    "agent",
    "agent_version",
    "agent_model",
    "agent_tools",
    "isolation",
    "isolation_attestation",
)


def validate_agent_config(config: dict[str, Any]) -> None:
    """Uma submissão de agente só é publicável com isolamento declarado e comprovado."""
    if config.get("model_classification") != "agent":
        return
    missing = [k for k in REQUIRED_AGENT_KEYS if not config.get(k)]
    if missing:
        raise ValueError(f"Submissão de agente sem campos obrigatórios: {', '.join(missing)}")
    if config["agent"] not in AGENTS:
        raise ValueError(f"Agente desconhecido: {config['agent']}")
    if config["isolation"] not in PUBLISHABLE_ISOLATIONS:
        raise ValueError(
            "Execução sem sandbox do sistema ou ambiente externo não é publicável; "
            "use --isolation sandbox-exec ou external"
        )
    attestation = config["isolation_attestation"]
    if not isinstance(attestation, dict) or not attestation.get("calls"):
        raise ValueError("Atestado de isolamento ausente ou sem chamadas")
    if config["isolation"] == "sandbox-exec" and not attestation.get("sandbox_profile_sha256"):
        raise ValueError("Isolamento sandbox-exec exige o hash do perfil aplicado")
    if attestation.get("workdir_writes"):
        raise ValueError(
            "O agente escreveu arquivos no diretório de trabalho; execução não publicável"
        )
