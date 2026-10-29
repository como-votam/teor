"""Smoke do Workers AI: mede tokens e neurons estimados em poucos itens, sequencial e leve.

Uso: .venv/bin/python scripts/smoke_cloudflare.py [--limit N] [--models a,b,c]
Lê CLOUDFLARE_ACCOUNT_ID e CLOUDFLARE_API_TOKEN de .env. Nunca imprime o token.
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from teor.io import read_jsonl
from teor.models import Item
from teor.runner import SYSTEM, request_prompt

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "smoke"
SESSION_CAP_NEURONS = 6000  # teto estimado da sessão; a franquia diária é 10.000

# neurons por milhão de tokens (entrada, saída), da página de preços de 2026-10-26
MODELS = {
    "@cf/meta/llama-3.1-8b-instruct-fp8-fast": {"in": 4119, "out": 34868, "max_tokens": 400},
    "@cf/openai/gpt-oss-20b": {"in": 18182, "out": 27273, "max_tokens": 1200},
    "@cf/meta/llama-3.3-70b-instruct-fp8-fast": {"in": 26668, "out": 204805, "max_tokens": 400},
    "@cf/ibm-granite/granite-4.0-h-micro": {"in": 1542, "out": 10158, "max_tokens": 400},
}


def load_env() -> dict[str, str]:
    env = {}
    for line in (ROOT / ".env").read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip("'\"")
    return env


def call(account: str, token: str, model: str, prompt: str, max_tokens: int) -> dict:
    body = json.dumps(
        {
            "messages": [
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": prompt},
            ],
            "max_tokens": max_tokens,
            "temperature": 0,
        }
    ).encode()
    req = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/{model}",
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "teor-smoke/0.1",
        },
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return {"status": r.status, "headers": dict(r.headers), "json": json.load(r)}


def extract_text(result: dict) -> str:
    if not isinstance(result, dict):
        return ""
    if isinstance(result.get("response"), str):
        return result["response"]
    ch = result.get("choices")
    if ch:
        return (ch[0].get("message") or {}).get("content") or ch[0].get("text") or ""
    return json.dumps(result.get("output", ""), ensure_ascii=False)


def pick_items(n: int) -> list[Item]:
    rows = read_jsonl(ROOT / "data" / "benchmark" / "test-lite-nog.jsonl")
    step = max(1, len(rows) // n)
    return [Item.model_validate(r) for r in rows[::step][:n]]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=50)
    ap.add_argument("--models", default=",".join(MODELS))
    args = ap.parse_args()
    env = load_env()
    account, token = env["CLOUDFLARE_ACCOUNT_ID"], env["CLOUDFLARE_API_TOKEN"]
    items = pick_items(args.limit)
    OUT.mkdir(parents=True, exist_ok=True)
    spent = 0.0
    summary = []
    for model in args.models.split(","):
        cfg = MODELS[model]
        path = OUT / ("cloudflare-" + model.split("/")[-1] + ".jsonl")
        rows, ntok_in, ntok_out, neur, errors, has_usage = 0, 0, 0, 0.0, 0, False
        first_headers = None
        with path.open("w") as f:
            for item in items:
                prompt = request_prompt(item, 0)
                worst = (len(prompt) / 3.5 * cfg["in"] + cfg["max_tokens"] * cfg["out"]) / 1e6
                if spent + worst > SESSION_CAP_NEURONS:
                    print(f"[{model}] teto da sessão atingido; parando", file=sys.stderr)
                    break
                rec = {"item_id": item.id, "model": model}
                try:
                    try:
                        resp = call(account, token, model, prompt, cfg["max_tokens"])
                    except urllib.error.HTTPError as e:
                        if e.code not in (429, 500, 502, 503):
                            raise
                        spent += worst  # retry conta como gasto até prova em contrário
                        time.sleep(5)
                        resp = call(account, token, model, prompt, cfg["max_tokens"])
                    res = resp["json"].get("result", {})
                    text = extract_text(res)
                    usage = res.get("usage") if isinstance(res, dict) else None
                    if usage:
                        has_usage = True
                        tin = usage.get("prompt_tokens", 0)
                        tout = usage.get("completion_tokens", 0)
                    else:
                        tin, tout = round(len(prompt) / 3.5), round(len(text) / 3.5)
                    n = (tin * cfg["in"] + tout * cfg["out"]) / 1e6
                    if usage and usage.get("neurons") is not None:
                        n = float(usage["neurons"])  # valor oficial devolvido pela API
                    rec.update(
                        response=text,
                        input_tokens=tin,
                        output_tokens=tout,
                        neurons_est=n,
                        usage=usage,
                        finish=(res.get("choices") or [{}])[0].get("finish_reason")
                        if isinstance(res, dict)
                        else None,
                    )
                    first_headers = first_headers or {
                        k: v
                        for k, v in resp["headers"].items()
                        if k.lower().startswith(("cf-", "x-"))
                    }
                    ntok_in += tin
                    ntok_out += tout
                    neur += n
                    spent += n
                    rows += 1
                except Exception as e:  # registra e segue; erro HTTP pode ter consumido neurons
                    errors += 1
                    rec["error"] = f"{type(e).__name__}: {str(e)[:200]}"
                    spent += worst / 4
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
                f.flush()
                time.sleep(0.3)
        summary.append((model, rows, errors, ntok_in, ntok_out, neur, has_usage, first_headers))
        print(
            f"[{model}] ok={rows} erros={errors} in={ntok_in} out={ntok_out} neurons_est={neur:.0f}"
        )
    print(f"\nTOTAL neurons estimados (sessão): {spent:.0f}")
    for s in summary:
        print(s[0], "usage_na_resposta=", s[6], "headers=", s[7])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
