"""Soma neurons (tokens × taxa de config/prices-cloudflare.json) dos logs Inspect de um diretório.

Uso: .venv/bin/python scripts/neurons_from_logs.py DIR_DE_LOGS [config/prices-cloudflare.json]
Leve: lê só os resumos das amostras quando possível. Não chama API.
"""

import json
import sys
from pathlib import Path

from inspect_ai.log import read_eval_log

logs = sorted(Path(sys.argv[1]).glob("*.eval"))
prices = json.loads(
    Path(sys.argv[2] if len(sys.argv) > 2 else "config/prices-cloudflare.json").read_text()
)
rates = prices["neurons_per_million"]
total = calls = tin = tout = 0
for p in logs:
    log = read_eval_log(str(p))
    for s in log.samples or []:
        for model, u in (s.model_usage or {}).items():
            r = rates[model]
            total += (u.input_tokens * r["input"] + u.output_tokens * r["output"]) / 1e6
            tin += u.input_tokens
            tout += u.output_tokens
            calls += 1
print(f"logs={len(logs)} chamadas={calls} in={tin} out={tout} neurons={total:.0f}")
