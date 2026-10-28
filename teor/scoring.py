"""Métricas por experimento: citações presentes e fidelidade semântica são coisas diferentes."""

import json
import math
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import UTC, datetime
from typing import Any

import numpy as np

from teor.io import canonical, digest
from teor.models import Item, Prediction, PredictionStatus, Result

PROTOCOL = {
    "version": "1.0",
    "variants": 3,
    "bootstrap": 2000,
    "confidence": 0.95,
    "seed": 2026,
    "invalid_score": 0,
    "infrastructure": "excluded_and_incomplete",
    "normalization": "NFKC-casefold-whitespace",
    # Formato do prompt e do parser: mudar qualquer um invalida a comparação com resultados antigos.
    "prompt_format": "value-abstain-hints-v2",
    "parser": "tolerant-v1",
}


def normalize(value: Any) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", str(value)).casefold()).strip()


FENCE = re.compile(r"```[A-Za-z0-9_-]*[ \t]*\n?(.*?)\n?[ \t]*```", re.S)
# Só tradução literal das duas chaves do schema; qualquer outra chave continua inválida.
KEY_ALIASES = {
    "value": "value",
    "valor": "value",
    "resposta": "value",
    "answer": "value",
    "abstain": "abstain",
    "abstencao": "abstain",
    "abstenção": "abstain",
    "abstencoes": "abstain",
    "abstenha_se": "abstain",
}


def extract_object(raw: str) -> Any:
    """Tira ruído de formato (cerca markdown, texto em volta) sem alterar o conteúdo."""
    text = raw.strip()
    fenced = FENCE.search(text)
    if fenced:
        text = fenced.group(1).strip()
    try:
        return json.loads(text)
    except ValueError:
        start = text.find("{")
        if start < 0:
            raise
        value, _ = json.JSONDecoder().raw_decode(text[start:])
        return value


def parse_response(raw: str) -> tuple[Any, bool, PredictionStatus]:
    try:
        parsed = extract_object(raw)
        if not isinstance(parsed, dict):
            return None, False, "invalid"
        value: dict[str, Any] = {}
        for key, item in parsed.items():
            canonical_key = KEY_ALIASES.get(str(key).strip().casefold())
            if canonical_key is None or canonical_key in value:
                return None, False, "invalid"
            value[canonical_key] = item
        abstain = value.get("abstain", False)
        if not isinstance(abstain, bool) or (not abstain and "value" not in value):
            return None, False, "invalid"
        return value.get("value"), abstain, "ok"
    except (ValueError, TypeError):
        return None, False, "invalid"


def score_one(item: Item, prediction: Prediction) -> dict[str, Any]:
    if prediction.status == "infrastructure_error":
        return {"score": None, "status": prediction.status}
    if prediction.status != "ok":
        if item.track == "F":
            return {
                "score": None,
                "citation_validity": 0.0,
                "status": prediction.status,
                "human_required": True,
            }
        return {"score": 0.0, "status": prediction.status}
    if not item.answerable:
        return {"score": float(prediction.abstain), "correct_abstention": float(prediction.abstain)}
    if prediction.abstain:
        if item.track == "F":
            return {"score": None, "citation_validity": 0.0, "human_required": True}
        return {"score": 0.0, "abstained": True}
    expected, response, kind = item.answer.value, prediction.response, item.answer.type
    if kind == "claims":
        claims = response.get("claims") if isinstance(response, dict) else None
        if not isinstance(claims, list) or not claims:
            return {"score": None, "citation_validity": 0.0, "human_required": True}
        documents = {d["ref"]: d["text"] for d in item.context.get("documents", [])}
        valid = sum(
            isinstance(c, dict)
            and isinstance(c.get("text"), str)
            and isinstance(c.get("quote"), str)
            and isinstance(c.get("ref"), str)
            and bool(c.get("quote"))
            and c.get("ref") in documents
            and c["quote"] in documents[c["ref"]]
            for c in claims
        )
        return {
            "score": None,
            "citation_validity": valid / len(claims),
            "claim_count": len(claims),
            "human_required": True,
        }
    if kind == "integer":
        correct = (
            isinstance(response, int)
            and not isinstance(response, bool)
            and abs(response - expected) <= item.answer.tolerance
        )
        return {"score": float(correct)}
    if kind == "set":
        if not isinstance(response, list) or any(not isinstance(v, str) for v in response):
            return {"score": 0.0, "status": "invalid"}
        a, b = {normalize(v) for v in expected}, {normalize(v) for v in response}
        return {"score": 2 * len(a & b) / (len(a) + len(b)) if a or b else 1.0}
    if kind == "sequence":
        valid = isinstance(response, list) and all(isinstance(v, str) for v in response)
        return {
            "score": float(
                valid and [normalize(v) for v in response] == [normalize(v) for v in expected]
            )
        }
    if kind == "probability":
        if (
            not isinstance(response, (int, float))
            or isinstance(response, bool)
            or not math.isfinite(response)
            or not 0 <= response <= 1
        ):
            return {"score": 0.0, "brier": 1.0, "status": "invalid"}
        accuracy = float((response >= 0.5) == bool(expected))
        result = {"score": accuracy, "brier": (response - expected) ** 2}
        if item.baseline_probability is not None:
            result["brier_gain"] = (item.baseline_probability - expected) ** 2 - result["brier"]
        for name, probability in item.baseline_probabilities.items():
            result[f"brier_gain_{name}"] = (probability - expected) ** 2 - result["brier"]
        return result
    return {
        "score": float(isinstance(response, str) and normalize(response) == normalize(expected))
    }


def bootstrap(values: list[float], families: list[str], repeats: int = 2000) -> tuple[float, float]:
    grouped: dict[str, list[float]] = defaultdict(list)
    for value, family in zip(values, families, strict=True):
        grouped[family].append(value)
    sums = np.array([sum(v) for _, v in sorted(grouped.items())])
    counts = np.array([len(v) for _, v in sorted(grouped.items())])
    if not len(sums):
        return (float("nan"), float("nan"))
    rng = np.random.default_rng(2026)
    estimates = []
    for _ in range(repeats):
        chosen = rng.integers(0, len(sums), size=len(sums))
        estimates.append(float(sums[chosen].sum() / counts[chosen].sum()))
    return float(np.quantile(estimates, 0.025)), float(np.quantile(estimates, 0.975))


def aggregate(
    items: list[Item], predictions: list[Prediction], config: dict[str, Any] | None = None
) -> Result:
    lookup = {i.id: i for i in items}
    if len(lookup) != len(items):
        raise ValueError("Itens duplicados")
    keys: set[tuple[str, int]] = set()
    identities = {(p.run_id, p.model) for p in predictions}
    if len(identities) > 1:
        raise ValueError("Não misture modelos ou execuções")
    rows: dict[tuple[str, ...], list[tuple[Item, Prediction, dict[str, Any]]]] = defaultdict(list)
    for pred in predictions:
        if pred.item_id not in lookup:
            raise ValueError(f"Previsão de item desconhecido: {pred.item_id}")
        item = lookup[pred.item_id]
        if pred.variant >= len(item.prompts) or (pred.item_id, pred.variant) in keys:
            raise ValueError("Variante inválida ou previsão duplicada")
        keys.add((pred.item_id, pred.variant))
        group: tuple[str, ...] = (
            item.track,
            item.task,
            item.chamber,
            item.mode,
            item.split,
            "experimental" if item.experimental else "principal",
            item.temporal_quality or "not_applicable",
        )
        rows[group].append((item, pred, score_one(item, pred)))
    metrics = []
    for group, records in sorted(rows.items()):
        entry: dict[str, Any] = dict(
            zip(
                ("track", "task", "chamber", "mode", "split", "category", "temporal_quality"),
                group,
                strict=True,
            )
        )
        entry["predictions"] = len(records)
        for metric in (
            "score",
            "brier",
            "brier_gain",
            "brier_gain_random",
            "brier_gain_majority",
            "citation_validity",
            "correct_abstention",
        ):
            eligible = [(i, p, s[metric]) for i, p, s in records if s.get(metric) is not None]
            if not eligible:
                continue
            values, families = (
                [float(s) for _, _, s in eligible],
                [i.family for i, _, _ in eligible],
            )
            lo, hi = bootstrap(values, families)
            entry[metric] = {
                "mean": float(np.mean(values)),
                "ci95": [lo, hi],
                "n": len(values),
                "families": len(set(families)),
            }
        variants: dict[int, list[float]] = defaultdict(list)
        for _, prediction, score in records:
            if score.get("score") is not None:
                variants[prediction.variant].append(score["score"])
        means = [float(np.mean(v)) for _, v in sorted(variants.items())]
        entry["prompt_sensitivity"] = {
            "variant_means": means,
            "variance": float(np.var(means)) if means else None,
        }
        answerable = [
            s["score"] for i, _, s in records if i.answerable and s.get("score") is not None
        ]
        entry["answerable_accuracy"] = float(np.mean(answerable)) if answerable else None
        entry["infrastructure_errors"] = sum(
            p.status == "infrastructure_error" for _, p, _ in records
        )
        if group[0] == "F":
            entry["semantic_fidelity"] = "aguardando revisão humana"
        metrics.append(entry)
    # Diferenças pareadas são reamostradas por família, mantendo o mesmo fato em cada variante.
    paired: dict[tuple[str, str, str], dict[tuple[str, int], dict[str, tuple[str, float]]]] = (
        defaultdict(lambda: defaultdict(dict))
    )
    for item, pred, score in (r for bucket in rows.values() for r in bucket):
        if item.pair_id and item.pair_variant and score.get("score") is not None:
            paired[(item.chamber, item.mode, item.split)][(item.pair_id, pred.variant)][
                item.pair_variant
            ] = (item.family, score["score"])
    for dimensions, pairs in sorted(paired.items()):
        pair_variants = sorted({v for values in pairs.values() for v in values})
        for index, first in enumerate(pair_variants):
            for second in pair_variants[index + 1 :]:
                deltas = [
                    (values[first][0], values[first][1] - values[second][1])
                    for values in pairs.values()
                    if first in values and second in values
                ]
                if deltas:
                    lo, hi = bootstrap([d for _, d in deltas], [f for f, _ in deltas])
                    metrics.append(
                        {
                            "track": "H",
                            "task": "paired_gap",
                            "chamber": dimensions[0],
                            "mode": dimensions[1],
                            "split": dimensions[2],
                            "first": first,
                            "second": second,
                            "mean": float(np.mean([d for _, d in deltas])),
                            "ci95": [lo, hi],
                            "n": len(deltas),
                            "families": len({f for f, _ in deltas}),
                            "interpretation": "diferença pareada, não diagnóstico causal",
                        }
                    )
    expected = sum(len(i.prompts) for i in items)
    latency = [p.latency_seconds for p in predictions if p.latency_seconds is not None]
    run_id, model = next(iter(identities), ("empty", "none"))
    return Result(
        id=run_id,
        model=model,
        protocol_hash=digest(PROTOCOL),
        dataset_hash=digest(items),
        complete=len(keys) == expected
        and all(p.status != "infrastructure_error" for p in predictions),
        created_at=datetime.now(UTC),
        config={**(config or {}), **PROTOCOL},
        metrics=metrics,
        usage={
            "expected": expected,
            "received": len(keys),
            "coverage": len(keys) / expected if expected else 0,
            "statuses": dict(Counter(p.status for p in predictions)),
            "input_tokens": sum(p.input_tokens for p in predictions),
            "output_tokens": sum(p.output_tokens for p in predictions),
            "cost_usd": sum(p.cost_usd or 0 for p in predictions)
            if predictions and all(p.cost_usd is not None for p in predictions)
            else None,
            "latency_mean_seconds": float(np.mean(latency)) if latency else None,
            "tool_calls": sum(p.tool_calls for p in predictions),
        },
    )


def baselines(
    items: list[Item], dev: list[Item], method: str = "random", seed: int = 2026
) -> list[Prediction]:
    if method not in ("random", "majority", "bm25", "orientation"):
        raise ValueError("Baseline desconhecido")
    candidates: dict[tuple[str, str, str, str], list[Item]] = defaultdict(list)
    for item in dev:
        if item.split != "dev":
            raise ValueError("Baselines devem ser ajustados somente em dev")
        if item.answerable:
            candidates[(item.chamber, item.track, item.task, item.answer.type)].append(item)
    indexes = {}
    if method == "bm25":
        from rank_bm25 import BM25Okapi

        indexes = {
            key: BM25Okapi(
                [
                    normalize(canonical(p.context).decode()).split() or ["registro"]
                    for p in population
                ]
            )
            for key, population in candidates.items()
        }
    results = []
    for item in items:
        population = candidates[(item.chamber, item.track, item.task, item.answer.type)]
        for variant in range(len(item.prompts)):
            rng = np.random.default_rng(
                int(digest({"seed": seed, "item": item.id, "variant": variant})[:16], 16)
            )
            value, abstain = None, False
            if method == "orientation":
                if item.track != "E" or item.baseline_probability is None:
                    continue
                value = item.baseline_probability
            elif item.answer.type == "probability":
                value = (
                    0.5
                    if method == "random" or not population
                    else float(np.mean([p.answer.value for p in population]))
                )
            elif population:
                if method == "majority":
                    counts = Counter(canonical(p.answer.value) for p in population)
                    value = json.loads(sorted(counts, key=lambda v: (-counts[v], v))[0])
                elif method == "bm25":
                    bm25 = indexes[(item.chamber, item.track, item.task, item.answer.type)]
                    scores = bm25.get_scores(
                        normalize(item.prompts[variant] + canonical(item.context).decode()).split()
                    )
                    value = population[int(np.argmax(scores))].answer.value
                else:
                    value = population[int(rng.integers(len(population)))].answer.value
            else:
                abstain = True
            results.append(
                Prediction(
                    item_id=item.id,
                    variant=variant,
                    run_id=f"baseline-{method}-{seed}",
                    model=f"baseline/{method}",
                    response=value,
                    abstain=abstain,
                    cost_usd=0,
                )
            )
    return results
