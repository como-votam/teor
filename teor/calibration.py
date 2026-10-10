"""Dificuldade empírica exige resultados; o rótulo do template sozinho não é uma medição."""

from collections import defaultdict
from pathlib import Path
from typing import Any

from teor.io import digest, write_json, write_jsonl
from teor.models import Item, Prediction
from teor.runner import run
from teor.scoring import aggregate, score_one


async def run_suite(items: list[Item], config: dict[str, Any], prices: Path, output: Path) -> None:
    models = config.get("models", [])
    if {m.get("class") for m in models} != {"small", "frontier"} or len(
        {m["name"] for m in models}
    ) != len(models):
        raise ValueError("Calibração exige modelos distintos, classificados como small e frontier")
    if any(m.get("budget_usd", 0) <= 0 for m in models):
        raise ValueError("Cada modelo exige orçamento explícito")
    for model in models:
        destination = output / digest(model["name"])[:16]
        predictions = await run(
            items,
            model["name"],
            destination / "predictions.jsonl",
            prices,
            model["budget_usd"],
            config.get("max_output", 1024),
            config.get("concurrency", 2),
            config.get("api_url"),
            model.get("base_url"),
        )
        write_json(
            destination / "result.json",
            aggregate(items, predictions, {"model_classification": model["class"]}),
        )


def recalibrate(items: list[Item], predictions: list[Prediction], output: Path) -> dict[str, Any]:
    if output.exists():
        raise ValueError("Recalibração exige destino novo")
    lookup = {i.id: i for i in items}
    measured: dict[str, list[float]] = defaultdict(list)
    identities = set()
    for prediction in predictions:
        key = (prediction.model, prediction.run_id, prediction.item_id, prediction.variant)
        if key in identities or prediction.item_id not in lookup:
            raise ValueError("Previsão duplicada ou item desconhecido")
        identities.add(key)
        score = score_one(lookup[prediction.item_id], prediction).get("score")
        if score is not None:
            measured[prediction.item_id].append(score)
    updated = []
    summaries = []
    prediction_hash = digest(predictions)
    for original in items:
        item = original.model_copy(deep=True)
        values = measured.get(item.id, [])
        if values:
            accuracy = sum(values) / len(values)
            item.difficulty = "easy" if accuracy >= 0.8 else "hard" if accuracy <= 0.3 else "medium"
            item.generator += f"+calibration-{prediction_hash[:12]}"
            summaries.append(
                {
                    "item_id": item.id,
                    "accuracy": accuracy,
                    "observations": len(values),
                    "difficulty": item.difficulty,
                }
            )
        updated.append(item)
    write_jsonl(output / "items.jsonl", updated)
    report = {
        "previous_hash": digest(items),
        "dataset_hash": digest(updated),
        "prediction_hash": digest(predictions),
        "items_measured": len(summaries),
        "models": sorted({p.model for p in predictions}),
        "items": summaries,
        "fidelity": "A trilha F permanece sujeita à revisão humana.",
    }
    write_json(output / "calibration.json", report)
    return report
