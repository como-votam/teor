"""O site recebe apenas projeções públicas; diretórios de trabalho não são raízes de publicação."""

from pathlib import Path
from typing import Any

import pyarrow as pa
import pyarrow.parquet as pq

from teor.io import CANARY, canonical, digest, read_json, write_json
from teor.models import Item, Prediction, Result, Round
from teor.scoring import score_one


def export_site(
    items: list[Item],
    results_dir: Path,
    output: Path,
    predictions: list[Prediction] | None = None,
    rounds_dir: Path | None = None,
) -> dict[str, Any]:
    if any(i.split == "test-private" for i in items):
        raise ValueError("Site não aceita material oculto; publique a rodada separadamente")
    if any(i.split == "test-live" for i in items):
        published = (
            [Round.model_validate(read_json(f)) for f in rounds_dir.glob("*/round.json")]
            if rounds_dir
            else []
        )
        if not any(r.state == "published" and r.dataset_hash == digest(items) for r in published):
            raise ValueError(
                "Lote oculto de Live exige comprovação de divulgação da rodada inteira"
            )
    results = []
    for file in sorted(results_dir.glob("*.json")):
        result = Result.model_validate(read_json(file))
        if result.dataset_hash != digest(items):
            raise ValueError(f"Resultado usa outro conjunto: {file.name}")
        results.append(result.model_dump(mode="json"))
    public = output / "public/data"
    public.mkdir(parents=True, exist_ok=True)
    for stale in public.glob("items-*.parquet"):
        if not stale.resolve().is_relative_to(public.resolve()):
            raise ValueError("Partição aponta para fora da exportação")
        stale.unlink()
    # Cada partição tem tamanho limitado; o explorador não precisa baixar o dataset inteiro.
    partitions = []
    for offset in range(0, len(items), 100):
        subset = items[offset : offset + 100]
        name = f"items-{offset // 100:04}.parquet"
        rows = [
            {
                "id": i.id,
                "track": i.track,
                "task": i.task,
                "chamber": i.chamber,
                "mode": i.mode,
                "prompt": i.prompts[0],
                "item_json": canonical(i).decode(),
            }
            for i in subset
        ]
        pq.write_table(pa.Table.from_pylist(rows), public / name, compression="zstd")
        partitions.append(
            {
                "url": f"/data/{name}",
                "count": len(rows),
                "tracks": sorted({i.track for i in subset}),
            }
        )
    quiz_candidates = [
        i
        for i in items
        if i.track in ("A", "B", "C", "D")
        and i.mode == "with_context"
        and i.answerable
        and i.answer.type in ("string", "integer", "set")
        and not i.experimental
    ]
    buckets: dict[tuple[str, str], list[Item]] = {}
    for item in sorted(quiz_candidates, key=lambda i: digest(i.id)):
        buckets.setdefault((item.track, item.chamber), []).append(item)
    quiz = [
        bucket[index]
        for index in range(max((len(v) for v in buckets.values()), default=0))
        for _, bucket in sorted(buckets.items())
        if index < len(bucket)
    ][:10]
    quiz_ids = {i.id for i in quiz}
    lookup = {i.id: i for i in items}
    safe_predictions = []
    for pred in predictions or []:
        if pred.item_id not in lookup:
            raise ValueError("Previsão pública não corresponde ao conjunto")
        if pred.item_id not in quiz_ids or pred.variant != 0:
            continue
        safe_predictions.append(
            {
                k: pred.model_dump(mode="json")[k]
                for k in ("item_id", "variant", "run_id", "model", "response", "abstain", "status")
            }
        )
    examples = []
    for result_data in results:
        model_predictions = [
            p
            for p in predictions or []
            if p.model == result_data["model"] and p.run_id == result_data["id"] and p.variant == 0
        ]
        for outcome in (0, 1):
            for pred in model_predictions:
                item = lookup[pred.item_id]
                if item.track != "F" and score_one(item, pred).get("score") == outcome:
                    examples.append(
                        {
                            "model": pred.model,
                            "run_id": pred.run_id,
                            "item": item.model_dump(mode="json"),
                            "response": pred.response,
                            "score": outcome,
                        }
                    )
                    break
    rounds = []
    if rounds_dir:
        for file in sorted(rounds_dir.glob("*/round.json")):
            round_ = Round.model_validate(read_json(file))
            if round_.state == "published":
                rounds.append(round_.model_dump(mode="json"))
    payload = {
        "results": results,
        "partitions": partitions,
        "quiz": [i.model_dump(mode="json") for i in quiz],
        "predictions": safe_predictions,
        "examples": examples,
        "rounds": rounds,
        "count": len(items),
        "dataset_hash": digest(items),
        "canary": CANARY,
    }
    write_json(output / "src/data/generated.json", payload)
    write_json(
        public / "manifest.json",
        {k: payload[k] for k in ("partitions", "count", "dataset_hash", "canary")},
    )
    return {
        "items": len(items),
        "results": len(results),
        "partitions": len(partitions),
        "quiz": len(quiz),
    }
