"""Operação local: divulgação e selo de qualidade são transições explícitas e auditáveis."""

from collections import Counter, defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from teor.build import load_items, public_question
from teor.io import digest, read_json, read_jsonl, write_json, write_jsonl
from teor.models import Item, Prediction, Result, Review, Round
from teor.scoring import aggregate, bootstrap


def create_round(
    items: list[Item], output: Path, name: str, opens_at: datetime, closes_at: datetime
) -> Round:
    if (output / "round.json").exists():
        raise ValueError("Rodada já existe")
    if any(i.split not in ("test-private", "test-live") for i in items):
        raise ValueError("Rodada oculta exige grupos que nunca entraram nas divisões públicas")
    identities = {(i.id, i.family) for i in items}
    if len(identities) != len(items):
        raise ValueError("Itens duplicados")
    hidden = [i.model_copy(update={"split": "test-live"}) for i in items]
    round_ = Round(id=name, opens_at=opens_at, closes_at=closes_at, dataset_hash=digest(hidden))
    write_json(output / "round.json", round_)
    write_jsonl(output / "private/answers.jsonl", hidden)
    return round_


def export_round(root: Path, output: Path, now: datetime | None = None) -> None:
    round_ = Round.model_validate(read_json(root / "round.json"))
    now = now or datetime.now(UTC)
    if round_.state != "open" or not round_.opens_at <= now < round_.closes_at:
        raise ValueError("Rodada não está aberta")
    items = load_items(root / "private/answers.jsonl")
    if digest(items) != round_.dataset_hash:
        raise ValueError("Lote da rodada foi alterado")
    write_jsonl(output / "questions.jsonl", [public_question(i) for i in items])
    write_json(output / "round.json", round_)


def close_round(root: Path, now: datetime | None = None) -> Round:
    round_ = Round.model_validate(read_json(root / "round.json"))
    if round_.state != "open" or (now or datetime.now(UTC)) < round_.closes_at:
        raise ValueError("Rodada ainda não pode fechar")
    round_.state = "closed"
    write_json(root / "round.json", round_)
    return round_


def publish_round(root: Path, output: Path, now: datetime | None = None) -> Round:
    round_ = Round.model_validate(read_json(root / "round.json"))
    if round_.state != "closed":
        raise ValueError("Feche a rodada antes de divulgar gabaritos")
    items = load_items(root / "private/answers.jsonl")
    if digest(items) != round_.dataset_hash:
        raise ValueError("Gabarito não corresponde ao lote congelado")
    if output.resolve().is_relative_to((root / "private").resolve()):
        raise ValueError("Destino público deve ser separado do gabarito")
    write_jsonl(output / "answers.jsonl", items)
    round_.state, round_.published_at = "published", now or datetime.now(UTC)
    write_json(output / "round.json", round_)
    write_json(root / "round.json", round_)
    return round_


def export_reviews(
    items: list[Item], output: Path, predictions: list[Prediction] | None = None
) -> None:
    rows: list[dict[str, Any]] = []
    if predictions is None:
        rows = [
            {
                "item_id": i.id,
                "item_hash": digest(i),
                "prompt": i.prompts[0],
                "context": i.context,
                "answer": i.answer.model_dump(mode="json"),
                "evidence": [e.model_dump(mode="json") for e in i.evidence],
            }
            for i in items
        ]
    else:
        lookup = {i.id: i for i in items}
        for prediction in predictions:
            item = lookup[prediction.item_id]
            if item.track != "F" or prediction.status != "ok":
                continue
            response = prediction.response
            for index, claim in enumerate(
                response.get("claims", []) if isinstance(response, dict) else []
            ):
                rows.append(
                    {
                        "item_id": item.id,
                        "item_hash": digest(item),
                        "prediction_id": f"{prediction.run_id}:{item.id}:{prediction.variant}",
                        "claim_index": index,
                        "claim": claim,
                        "context": item.context,
                        "evidence": [e.model_dump(mode="json") for e in item.evidence],
                    }
                )
    write_json(output / "review-batch.json", {"items": rows, "hash": digest(rows)})
    # O lote vive no navegador local do revisor; jamais é incorporado ao site público.
    import shutil

    source = Path("site/public/review-local.html")
    if source.exists():
        shutil.copyfile(source, output / "index.html")
    else:
        from importlib.resources import files

        (output / "index.html").write_text(
            files("teor").joinpath("resources/review-local.html").read_text(encoding="utf-8"),
            encoding="utf-8",
        )


def import_reviews(source: Path, destination: Path) -> list[Review]:
    reviews = [Review.model_validate(r) for r in read_jsonl(source)]
    existing = (
        [Review.model_validate(r) for r in read_jsonl(destination)] if destination.exists() else []
    )
    identities = {
        (r.item_id, r.item_hash, r.prediction_id, r.claim_index, r.reviewer, r.adjudication)
        for r in existing
    }
    for review in reviews:
        key = (
            review.item_id,
            review.item_hash,
            review.prediction_id,
            review.claim_index,
            review.reviewer,
            review.adjudication,
        )
        if key in identities:
            raise ValueError("Revisão duplicada; correções exigem nova versão do lote")
        identities.add(key)
        existing.append(review)
    write_jsonl(destination, existing)
    return existing


def review_report(reviews: list[Review]) -> dict[str, Any]:
    groups: dict[tuple[str, str | None, int | None, str | None], list[Review]] = defaultdict(list)
    for review in reviews:
        groups[(review.item_id, review.prediction_id, review.claim_index, review.item_hash)].append(
            review
        )
    decisions, pairs = [], []
    for key, rows in sorted(groups.items(), key=lambda pair: str(pair[0])):
        independent = [r for r in rows if not r.adjudication]
        if len({r.reviewer for r in independent}) != len(independent):
            raise ValueError("Mesmo revisor aparece duas vezes no mesmo julgamento")
        adjudicated = [r for r in rows if r.adjudication]
        if len(adjudicated) > 1:
            raise ValueError("Adjudicação duplicada")
        if adjudicated and (
            len(independent) < 2 or adjudicated[0].reviewer in {r.reviewer for r in independent}
        ):
            raise ValueError("Adjudicação exige dois revisores e um terceiro responsável")
        if len(independent) >= 2:
            first, second = sorted(independent, key=lambda r: r.reviewer)[:2]
            pairs.append((first.judgement, second.judgement))
        judgement = (
            adjudicated[0].judgement
            if adjudicated
            else independent[0].judgement
            if len(independent) >= 2 and len({r.judgement for r in independent}) == 1
            else "uncertain"
        )
        decisions.append(
            {
                "item_id": key[0],
                "item_hash": key[3],
                "prediction_id": key[1],
                "claim_index": key[2],
                "judgement": judgement,
                "gold": key[1] is None and len(independent) >= 2 and judgement == "supported",
                "reviewers": len(independent),
                "adjudicated": bool(adjudicated),
            }
        )
    agreement = sum(a == b for a, b in pairs) / len(pairs) if pairs else None
    expected = None
    if pairs:
        left, right = Counter(a for a, _ in pairs), Counter(b for _, b in pairs)
        expected = sum(left[k] * right[k] for k in set(left) | set(right)) / len(pairs) ** 2
    kappa = (
        (agreement - expected) / (1 - expected)
        if agreement is not None and expected is not None and expected < 1
        else None
    )
    fidelity = [
        d["judgement"] == "supported"
        for d in decisions
        if d["prediction_id"] is not None and d["judgement"] != "uncertain"
    ]
    return {
        "decisions": decisions,
        "paired_reviews": len(pairs),
        "agreement": agreement,
        "cohen_kappa": kappa,
        "semantic_fidelity": sum(fidelity) / len(fidelity) if fidelity else None,
        "semantic_claims_scored": len(fidelity),
    }


def validate_submission(
    items: list[Item],
    predictions: list[Prediction],
    result: Result,
    round_path: Path | None = None,
    reviews: list[Review] | None = None,
) -> Result:
    if round_path:
        round_ = Round.model_validate(read_json(round_path))
        if round_.state != "published":
            raise ValueError("Submissões públicas de rodadas ocultas exigem divulgação prévia")
    from teor.agents import validate_agent_config

    validate_agent_config(result.config)
    computed = aggregate(items, predictions, result.config)
    if reviews is not None:
        computed = attach_human_reviews(items, predictions, computed, reviews)
    if (
        result.dataset_hash != computed.dataset_hash
        or result.protocol_hash != computed.protocol_hash
        or result.metrics != computed.metrics
        or result.usage != computed.usage
        or result.complete != computed.complete
        or result.model != computed.model
    ):
        raise ValueError("Resultado não corresponde às previsões recalculadas")
    # Um arquivo enviado não pode autoatribuir evidência de reprodução.
    if result.verification != "autodeclarado":
        raise ValueError("Submissão externa deve ser autodeclarada")
    return computed


def attach_human_reviews(
    items: list[Item], predictions: list[Prediction], result: Result, reviews: list[Review]
) -> Result:
    lookup = {i.id: i for i in items}
    decisions = review_report(reviews)["decisions"]
    identities = {f"{p.run_id}:{p.item_id}:{p.variant}": p for p in predictions}
    judged = {}
    for decision in decisions:
        key = decision["prediction_id"]
        if key is None:
            continue
        if (
            key not in identities
            or decision["item_id"] not in lookup
            or decision["item_hash"] != digest(lookup[decision["item_id"]])
        ):
            raise ValueError("Revisão não corresponde à previsão ou à versão do item")
        pred = identities[key]
        claims = pred.response.get("claims", []) if isinstance(pred.response, dict) else []
        if (
            lookup[pred.item_id].track != "F"
            or pred.status != "ok"
            or pred.abstain
            or not isinstance(claims, list)
        ):
            raise ValueError("Julgamentos de fidelidade exigem afirmações válidas da trilha F")
        if decision["item_id"] != pred.item_id or decision["claim_index"] >= len(claims):
            raise ValueError("Índice de afirmação não corresponde à resposta")
        if decision["reviewers"] >= 2 and decision["judgement"] != "uncertain":
            judged[(key, decision["claim_index"])] = decision["judgement"] == "supported"
    updated = result.model_copy(deep=True)
    for metric in updated.metrics:
        if metric.get("track") != "F":
            continue
        selected = [
            p
            for p in predictions
            if lookup[p.item_id].track == "F"
            and lookup[p.item_id].chamber == metric["chamber"]
            and lookup[p.item_id].mode == metric["mode"]
            and lookup[p.item_id].split == metric["split"]
        ]
        values, families = [], []
        claims_total = 0
        for pred in selected:
            claims = pred.response.get("claims", []) if isinstance(pred.response, dict) else []
            claims_total += len(claims)
            identity = f"{pred.run_id}:{pred.item_id}:{pred.variant}"
            for index in range(len(claims)):
                if (identity, index) in judged:
                    values.append(float(judged[(identity, index)]))
                    families.append(lookup[pred.item_id].family)
        metric["human_review_coverage"] = {
            "claims": claims_total,
            "reviewed": len(values),
            "coverage": len(values) / claims_total if claims_total else 0,
        }
        if values:
            metric["human_fidelity"] = {
                "mean": sum(values) / len(values),
                "ci95": list(bootstrap(values, families)),
                "families": len(set(families)),
                "n": len(values),
            }
            metric["semantic_fidelity"] = (
                "revisão humana concluída"
                if len(values) == claims_total
                else "revisão humana parcial"
            )
    updated.config["review_hash"] = digest(reviews)
    return updated


def promote_gold(items: list[Item], reviews: list[Review], output: Path) -> dict[str, Any]:
    if output.exists():
        raise ValueError("Promoção exige destino novo para preservar a revisão anterior")
    decisions = review_report(reviews)["decisions"]
    approved = {(d["item_id"], d["item_hash"]) for d in decisions if d["gold"]}
    gold = [i for i in items if (i.id, digest(i)) in approved]
    # Uma revisão antiga do mesmo ID não valida um gabarito corrigido.
    write_jsonl(output / "items.jsonl", gold)
    report = {
        "dataset_hash": digest(gold),
        "items": len(gold),
        "candidate_items": len(items),
        "review_hash": digest(reviews),
        "decisions": decisions,
    }
    write_json(output / "manifest.json", report)
    return report


def apply_errata(
    items: list[Item], corrections: list[dict[str, Any]], output: Path
) -> dict[str, Any]:
    from teor.build import validate_items
    from teor.models import Answer, Evidence

    if output.exists():
        raise ValueError("Errata exige destino novo; a versão anterior permanece intacta")
    lookup = {i.id: i.model_copy(deep=True) for i in items}
    seen = set()
    for correction in corrections:
        item = lookup[correction["item_id"]]
        if item.id in seen or correction["old_item_hash"] != digest(item):
            raise ValueError("Errata duplicada ou versão anterior divergente")
        if not correction.get("reason", "").strip() or not correction.get("url", "").startswith(
            "https://"
        ):
            raise ValueError("Errata exige motivo e fonte")
        seen.add(item.id)
        item.answer = Answer.model_validate(correction["answer"])
        item.evidence.append(
            Evidence(ref=f"errata:{item.id}", url=correction["url"], quote=correction.get("quote"))
        )
        item.generator += f"+errata-{digest(correction)[:12]}"
    updated = sorted(lookup.values(), key=lambda i: i.id)
    validate_items(updated)
    write_jsonl(output / "items.jsonl", updated)
    report = {
        "previous_hash": digest(items),
        "dataset_hash": digest(updated),
        "corrections": corrections,
        "review_required": sorted(seen),
    }
    write_json(output / "errata.json", report)
    return report
