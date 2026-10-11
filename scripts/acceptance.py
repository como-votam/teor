"""A entrega local usa dados reais e repete os artefatos determinísticos antes de apresentar notas."""

import argparse
from pathlib import Path

from teor.build import build_dataset, export_dataset, load_items, validate_items
from teor.io import digest, write_json, write_jsonl
from teor.operations import export_reviews
from teor.scoring import aggregate, baselines
from teor.site import export_site
from teor.sources import verify_snapshot

parser = argparse.ArgumentParser()
parser.add_argument("snapshot", type=Path)
args = parser.parse_args()
snapshot = verify_snapshot(args.snapshot)
print(f"Snapshot {snapshot.id}: {snapshot.state}; hashes verificados", flush=True)
first = build_dataset(args.snapshot, Path("data/benchmark"))
second = build_dataset(args.snapshot, Path("data/benchmark-repeat"))
if first != second:
    raise ValueError("Builds divergentes")
items = load_items(Path("data/benchmark/test-public.jsonl"))
dev = load_items(Path("data/benchmark/dev.jsonl"))
validate_items(load_items(Path("data/benchmark/private/eligible-items.jsonl")))
print(f"Determinismo aprovado; {len(items)} itens de teste; {len(dev)} itens em dev", flush=True)
all_predictions = []
baseline_reports = {}
for method in ("random", "majority", "bm25", "orientation"):
    predictions = baselines(items, dev, method)
    if predictions != baselines(items, dev, method):
        raise ValueError("Baseline não determinístico")
    write_jsonl(Path(f"data/baselines/{method}.jsonl"), predictions)
    if not predictions:
        baseline_reports[method] = {
            "eligible": 0,
            "reason": "Orientações sem comprovação anterior ao corte temporal",
        }
        continue
    result = aggregate(
        items,
        predictions,
        {
            "model_classification": "baseline",
            "snapshot": snapshot.id,
            "snapshot_state": snapshot.state,
            "price_as_of": "não se aplica",
            "weights_status": "não se aplica",
            "reproduction": "scripts/acceptance.py; previsões repetidas e comparadas",
        },
    )
    write_json(Path(f"results/baseline-{method}.json"), result)
    all_predictions.extend(predictions)
    baseline_reports[method] = {
        "predictions": len(predictions),
        "hash": digest(predictions),
        "metrics": len(result.metrics),
        "complete": result.complete,
    }
    print(
        f"Baseline {method}: {len(predictions)} previsões; {len(result.metrics)} métricas",
        flush=True,
    )
export_dataset(items, Path("exports/huggingface"))
gold_ids = set(first["gold_candidates"])
export_reviews(
    [i for i in load_items(Path("data/benchmark/items.jsonl")) if i.id in gold_ids],
    Path("private/gold-candidates"),
)
site = export_site(items, Path("results"), Path("site"), all_predictions)
report = {
    "snapshot": snapshot.model_dump(mode="json"),
    "build": first,
    "determinism": "passed",
    "baselines": baseline_reports,
    "site": site,
    "external_activities": [
        "avaliações reais de modelos",
        "revisão humana",
        "publicação HF/PyPI/Pages",
        "DNS",
        "CodeQL remoto após primeiro push",
    ],
}
write_json(Path("reports/acceptance.json"), report)
print(f"Exportações locais concluídas: {site}", flush=True)
