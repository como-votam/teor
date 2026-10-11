"""PRs não são confiáveis: o placar enviado deve corresponder às previsões."""

from pathlib import Path

from teor.build import load_items
from teor.io import read_json, read_jsonl
from teor.models import Prediction, Result, Review
from teor.operations import validate_submission

for root in sorted(Path("results/submissions").glob("*")):
    if root.is_dir():
        validate_submission(
            load_items(root / "items.jsonl"),
            [Prediction.model_validate(row) for row in read_jsonl(root / "predictions.jsonl")],
            Result.model_validate(read_json(root / "result.json")),
            root / "round.json" if (root / "round.json").exists() else None,
            [Review.model_validate(r) for r in read_jsonl(root / "reviews.jsonl")]
            if (root / "reviews.jsonl").exists()
            else None,
        )
for path in Path("results").glob("*.json"):
    Result.model_validate(read_json(path))
print("Resultados e pacotes presentes validados")
