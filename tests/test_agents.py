"""Os agentes reais não rodam aqui: testa-se o que protege o gabarito e o atestado de isolamento."""

import json

import pytest

from teor.agent_mcp import handle
from teor.agents import (
    AGENTS,
    agent_config,
    claude_parse,
    codex_build,
    codex_parse,
    load_prompts,
    preflight_rows,
    prompt_rows,
    sandbox_profile,
    scrubbed_env,
    validate_agent_config,
)
from teor.io import write_json, write_jsonl


def test_prompts_carry_no_gold(items):
    rows = prompt_rows(items[:20])
    blob = json.dumps(rows, ensure_ascii=False)
    assert all(
        set(r) == {"item_id", "variant", "track", "answer_type", "prompt", "prompt_format"}
        for r in rows
    )
    assert "gold" not in blob and '"answer"' not in blob
    assert len(rows) == sum(len(i.prompts) for i in items[:20])


def test_load_prompts_rejects_extra_keys(items, tmp_path):
    rows = prompt_rows(items[:1])
    rows[0]["answer"] = "segredo"
    write_jsonl(tmp_path / "p.jsonl", rows)
    with pytest.raises(ValueError, match="chaves inesperadas"):
        load_prompts(tmp_path / "p.jsonl")


def test_preflight_covers_each_format_once_without_g(items):
    chosen = preflight_rows(prompt_rows(items))
    assert chosen and all(r["track"] != "G" and r["variant"] == 0 for r in chosen)
    assert len({(r["track"], r["answer_type"]) for r in chosen}) == len(chosen)


def test_env_never_leaks_secrets(monkeypatch):
    for key in ("CLOUDFLARE_API_TOKEN", "GITHUB_TOKEN", "GEMINI_API_KEY", "ANTHROPIC_API_KEY"):
        monkeypatch.setenv(key, "x")
    env = scrubbed_env("codex")
    assert not {
        "CLOUDFLARE_API_TOKEN",
        "GITHUB_TOKEN",
        "GEMINI_API_KEY",
        "ANTHROPIC_API_KEY",
    } & set(env)
    assert "ANTHROPIC_API_KEY" in scrubbed_env("claude")


def test_sandbox_profile_denies_then_reallows_runtime(tmp_path):
    profile = sandbox_profile([tmp_path], [tmp_path / ".venv"])
    assert profile.index("deny file-read*") < profile.index("allow file-read*")


def test_claude_parse_reads_text_usage_and_cost():
    payload = {
        "type": "result",
        "is_error": False,
        "result": "{}",
        "total_cost_usd": 0.002,
        "usage": {"input_tokens": 10, "cache_read_input_tokens": 5, "output_tokens": 3},
        "num_turns": 1,
        "modelUsage": {"claude-haiku": {}},
    }
    out = claude_parse(json.dumps(payload), None)
    assert (out.text, out.input_tokens, out.output_tokens, out.cost_usd, out.tool_calls) == (
        "{}",
        15,
        3,
        0.002,
        0,
    )
    assert out.resolved_model == "claude-haiku"
    assert claude_parse(json.dumps({**payload, "is_error": True}), None).error


def test_codex_build_and_parse(tmp_path):
    plain = codex_build("m", None, tmp_path, tmp_path, False)
    assert "-s" in plain and "read-only" in plain and "--ignore-user-config" in plain
    assert "--dangerously-bypass-approvals-and-sandbox" in codex_build(
        "m", None, tmp_path, tmp_path, True
    )
    assert any(
        "mcp_servers.teor" in a for a in codex_build("m", "http://x", tmp_path, tmp_path, False)
    )
    (tmp_path / "last.txt").write_text('{"value": 1}')
    events = "\n".join(
        json.dumps(e)
        for e in (
            {"type": "item.completed", "item": {"type": "command_execution"}},
            {"type": "turn.completed", "usage": {"input_tokens": 7, "output_tokens": 2}},
        )
    )
    out = codex_parse(events, tmp_path)
    assert (out.text, out.input_tokens, out.output_tokens, out.tool_calls) == (
        '{"value": 1}',
        7,
        2,
        1,
    )


def test_mcp_exposes_only_snapshot_record(monkeypatch):
    monkeypatch.setattr("teor.agent_mcp.fetch", lambda url, rid: f"registro {rid}")
    listing = handle({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, "http://x")
    assert [t["name"] for t in listing["result"]["tools"]] == ["snapshot_record"]
    call = handle(
        {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {"name": "snapshot_record", "arguments": {"record_id": "r1"}},
        },
        "http://x",
    )
    assert call["result"]["content"][0]["text"] == "registro r1"
    other = handle(
        {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "bash"}}, "http://x"
    )
    assert "error" in other


def attested(isolation="sandbox-exec", **over):
    config = {
        "model_classification": "agent",
        "agent": "claude",
        "agent_version": "2.1",
        "agent_model": "haiku",
        "agent_tools": "x",
        "isolation": isolation,
        "isolation_attestation": {"calls": 9, "workdir_writes": 0, "sandbox_profile_sha256": "abc"},
    }
    return {**config, **over}


def test_agent_config_gate():
    validate_agent_config({"model_classification": "open-weights"})
    validate_agent_config(attested())
    validate_agent_config(
        attested("external", isolation_attestation={"calls": 1, "workdir_writes": 0})
    )
    for bad in (
        attested("workdir"),
        attested(agent="outro"),
        attested(agent_version=""),
        attested(
            isolation_attestation={"calls": 9, "workdir_writes": 2, "sandbox_profile_sha256": "a"}
        ),
        attested(isolation_attestation={"calls": 9, "workdir_writes": 0}),
        attested(isolation_attestation={}),
    ):
        with pytest.raises(ValueError):
            validate_agent_config(bad)


def test_agent_config_copies_the_run_attestation(tmp_path):
    out = tmp_path / "p.jsonl"
    stats = {k: 1 for k in ("calls", "workdir_writes", "tool_calls")} | {
        "agent": "claude",
        "agent_version": "v",
        "agent_model": "haiku",
        "agent_tools": "t",
        "system_prompt_channel": "c",
        "isolation": "sandbox-exec",
        "env_passed": ["PATH"],
        "sandbox_profile_sha256": "h",
        "deny_read_paths": 1,
        "prompts_sha256": "p",
        "adapter_verified_live": True,
    }
    write_json(out.with_suffix(".isolation.json"), stats)
    config = agent_config(out)
    assert config["model_classification"] == "agent" and set(AGENTS) >= {config["agent"]}
    assert config["isolation_attestation"]["sandbox_profile_sha256"] == "h"
