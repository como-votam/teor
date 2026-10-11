"""Detecta mudanças de contrato que não foram acompanhadas de schemas públicos."""

from pathlib import Path

from teor import models
from teor.io import read_json

for name in ("Snapshot", "Item", "PublicQuestion", "Prediction", "Result", "Round", "Review"):
    path = Path("docs/schemas") / f"{name.lower()}.schema.json"
    if read_json(path) != getattr(models, name).model_json_schema():
        raise SystemExit(f"Schema divergente: {name}; execute teor schemas")
print("Schemas correspondem aos contratos")
