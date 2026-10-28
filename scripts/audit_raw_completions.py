"""Exporta o texto bruto das respostas dos logs Inspect e classifica falhas de formato.

Uso: .venv/bin/python scripts/audit_raw_completions.py DIR_DE_LOGS SAIDA.jsonl
A nota oficial continua sendo a de `teor score` (parser estrito). A coluna `tolerant_status` é
apenas diagnóstico: mostra quantas respostas inválidas só falham por formato (cerca markdown ou
chaves traduzidas), sem alterar o protocolo.
"""

import json
import re
import sys
from collections import Counter
from pathlib import Path

from inspect_ai.log import read_eval_log

from teor.scoring import parse_response

FENCE = re.compile(r"\A\s*```[A-Za-z]*\s*\n(.*?)\n?\s*```\s*\Z", re.S)
VALUE_ALIASES = {"valor", "answer", "resposta"}
ABSTAIN_ALIASES = {"abstencao", "abstenção", "abstencoes", "abstenha_se"}


def classify(raw: str, stop: str | None) -> str:
    text = raw.strip()
    if not text:
        return "vazia"
    if stop == "max_tokens":
        return "truncada"
    if FENCE.match(text):
        return "cerca_markdown"
    try:
        value = json.loads(text)
    except ValueError:
        return "nao_json"
    if not isinstance(value, dict):
        return "json_nao_objeto"
    keys = set(value)
    if keys <= {"value", "abstain"}:
        return "schema_ok_valor_invalido"
    if keys & (VALUE_ALIASES | ABSTAIN_ALIASES):
        return "chaves_traduzidas"
    return "chaves_desconhecidas"


def tolerant(raw: str) -> str:
    m = FENCE.match(raw.strip())
    text = m.group(1) if m else raw
    try:
        value = json.loads(text)
    except ValueError:
        return "invalid"
    if isinstance(value, dict):
        value = {
            ("value" if k in VALUE_ALIASES else "abstain" if k in ABSTAIN_ALIASES else k): v
            for k, v in value.items()
        }
        text = json.dumps(value)
    return parse_response(text)[2]


latest = {}
for path in sorted(Path(sys.argv[1]).glob("*.eval")):  # nomes ordenam por hora; o último vale
    for s in read_eval_log(str(path)).samples or []:
        key = (s.metadata["item_id"], s.metadata["variant"])
        if s.error is None or key not in latest:
            latest[key] = s

rows, counts = [], Counter()
for s in latest.values():
    raw = s.output.completion or ""
    stop = s.output.stop_reason
    official = parse_response(raw)[2]
    kind = "ok" if official == "ok" else classify(raw, stop)
    counts[kind] += 1
    usage = list((s.model_usage or {}).values())
    rows.append(
        {
            "item_id": s.metadata["item_id"],
            "variant": s.metadata["variant"],
            "completion": raw,
            "stop_reason": stop,
            "official_status": official,
            "failure_kind": kind,
            "tolerant_status": tolerant(raw),
            "input_tokens": sum(u.input_tokens for u in usage),
            "output_tokens": sum(u.output_tokens for u in usage),
            "error": str(s.error) if s.error else None,
        }
    )
Path(sys.argv[2]).write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows))
print(f"{len(rows)} respostas exportadas")
for k, v in counts.most_common():
    print(f"  {k}: {v}")
print("tolerant_status:", dict(Counter(r["tolerant_status"] for r in rows)))
