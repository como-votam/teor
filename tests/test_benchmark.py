import asyncio
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from fastapi.testclient import TestClient

from teor.build import build_dataset, export_dataset, load_items, public_question, validate_items
from teor.io import digest, read_json, read_jsonl, write_json
from teor.models import Prediction, Result, Review
from teor.operations import (
    close_round,
    create_round,
    export_round,
    publish_round,
    review_report,
    validate_submission,
)
from teor.scoring import aggregate, baselines, bootstrap, parse_response, score_one
from teor.server import create_app
from teor.site import export_site
from teor.sources import Collector, verify_snapshot


def prediction(item, response=None, **kwargs):
    return Prediction(
        item_id=item.id, variant=0, run_id="test", model="mock/model", response=response, **kwargs
    )


def test_build_deterministic_and_no_leak(snapshot, tmp_path):
    first, second = tmp_path / "first", tmp_path / "second"
    a, b = build_dataset(snapshot, first), build_dataset(snapshot, second)
    assert a == b
    assert (first / "items.jsonl").read_bytes() == (second / "items.jsonl").read_bytes()
    assert set(a["tracks"]) == set("ABCDEFGH")
    splits = {
        name: load_items(first / ("private/" if name == "test-private" else "") / f"{name}.jsonl")
        for name in ("dev", "test-public", "test-private", "test-lite")
    }
    assert {i.family for i in splits["dev"]}.isdisjoint(i.family for i in splits["test-public"])
    assert {i.family for i in splits["test-private"]}.isdisjoint(
        i.family for i in splits["test-public"]
    )
    assert {i.id for i in splits["test-lite"]} <= {i.id for i in splits["test-public"]}
    assert all(i.split != "test-private" for i in load_items(first / "items.jsonl"))
    hidden = read_jsonl(first / "private/questions.jsonl")
    assert all("answer" not in i and "answerable" not in i and "evidence" not in i for i in hidden)


def test_snapshot_tamper(snapshot):
    (snapshot / "normalized/votes.jsonl").write_text("", encoding="utf-8")
    with pytest.raises(ValueError, match="Hash divergente"):
        verify_snapshot(snapshot)


def test_snapshot_path_traversal(snapshot):
    data = read_json(snapshot / "manifest.json")
    data["files"][0]["path"] = "../outside"
    write_json(snapshot / "manifest.json", data)
    with pytest.raises(ValueError, match="fora"):
        verify_snapshot(snapshot)


def test_prediction_temporal_and_parity(items):
    forecast = next(i for i in items if i.track == "E")
    assert not any(k in forecast.context for k in ("result", "votes", "orientations"))
    assert forecast.temporal_quality == "retrospective"
    forecast.context["result"] = "aprovada"
    with pytest.raises(ValueError, match="contém resultado"):
        validate_items([forecast])
    parity = [i for i in items if i.track == "H"]
    assert len(parity) == 3
    assert len({digest(i.answer) for i in parity}) == 1


def test_scorers_and_abstention(items):
    integer = next(i for i in items if i.answer.type == "integer")
    assert score_one(integer, prediction(integer, integer.answer.value))["score"] == 1
    assert score_one(integer, prediction(integer, str(integer.answer.value)))["score"] == 0
    unknown = next(i for i in items if not i.answerable)
    assert score_one(unknown, prediction(unknown, abstain=True))["score"] == 1
    assert score_one(unknown, prediction(unknown, "inventado"))["score"] == 0
    set_item = next(i for i in items if i.answer.type == "set")
    assert score_one(set_item, prediction(set_item, set_item.answer.value))["score"] == 1
    assert score_one(integer, prediction(integer, status="infrastructure_error"))["score"] is None
    forecast = next(i for i in items if i.track == "E")
    assert score_one(forecast, prediction(forecast, 0.5))["brier"] == 0.25
    assert score_one(forecast, prediction(forecast, float("nan")))["score"] == 0


def test_fidelity_not_an_automatic_score(items):
    item = next(i for i in items if i.track == "F")
    document = item.context["documents"][0]
    response = {
        "claims": [
            {
                "text": "Afirmação possivelmente falsa",
                "ref": document["ref"],
                "quote": document["text"][:15],
            }
        ]
    }
    scored = score_one(item, prediction(item, response))
    assert scored["score"] is None and scored["citation_validity"] == 1
    assert (
        score_one(item, prediction(item, {"claims": [{"text": "texto", "ref": {}, "quote": 17}]}))[
            "citation_validity"
        ]
        == 0
    )
    assert score_one(item, prediction(item, status="invalid"))["score"] is None


def test_parse_rejects_ambiguous_output():
    assert parse_response('{"value":187,"abstain":false}') == (187, False, "ok")
    assert parse_response('{"abstain":"true"}')[2] == "invalid"
    assert parse_response("187")[2] == "invalid"
    assert parse_response("```json\n{}\n```")[2] == "invalid"
    assert parse_response('```json\n{"value":["a"],"abstain":false}\n```') == (["a"], False, "ok")
    assert parse_response('Claro! {"value": 3} fim') == (3, False, "ok")
    assert parse_response('{"valor":["a"],"abstencao":false}') == (["a"], False, "ok")
    assert parse_response('{"value":1,"valor":2}')[2] == "invalid"
    assert parse_response('{"value":1,"extra":2}')[2] == "invalid"
    assert parse_response('{"value":[1,2')[2] == "invalid"


def test_bootstrap_clustered_and_repeatable():
    assert bootstrap([0, 0, 1, 1], ["a", "a", "b", "b"]) == (0, 1)
    assert bootstrap([1, 1], ["a", "a"]) == (1, 1)


def test_aggregate_rejects_mixed_and_duplicates(items):
    item = next(i for i in items if i.track == "C")
    pred = prediction(item, item.answer.value)
    with pytest.raises(ValueError, match="duplicada"):
        aggregate([item], [pred, pred])
    with pytest.raises(ValueError, match="misture"):
        aggregate([item], [pred, pred.model_copy(update={"model": "other"})])
    result = aggregate([item], [pred])
    assert not result.complete and result.usage["coverage"] == 1 / 3


def test_baselines_do_not_fit_test_answers(items):
    with pytest.raises(ValueError, match="dev"):
        baselines(items, items, "majority")
    dev = [i.model_copy(update={"split": "dev"}) for i in items]
    assert baselines(items, dev) == baselines(items, dev)
    assert baselines(items, dev, "orientation") == []


def test_round_withholds_answers(items, tmp_path):
    now = datetime.now(UTC)
    root, exported = tmp_path / "round", tmp_path / "public"
    create_round(
        [i.model_copy(update={"split": "test-private"}) for i in items[:2]],
        root,
        "round1",
        now - timedelta(hours=1),
        now + timedelta(hours=1),
    )
    export_round(root, exported, now)
    assert all("answer" not in row for row in read_jsonl(exported / "questions.jsonl"))
    with pytest.raises(ValueError):
        close_round(root, now)
    close_round(root, now + timedelta(hours=2))
    publish_round(root, exported, now + timedelta(hours=3))
    assert (exported / "answers.jsonl").exists()
    with pytest.raises(ValueError):
        export_site(
            [items[0].model_copy(update={"split": "test-live"})], tmp_path, tmp_path / "site"
        )


def test_review_independence_and_adjudication():
    def review(who, judgement, adjudication=False):
        return Review(
            item_id="one",
            reviewer=who,
            judgement=judgement,
            evidence="fonte",
            adjudication=adjudication,
            reviewed_at=datetime.now(UTC),
        )

    assert not review_report([review("a", "supported")])["decisions"][0]["gold"]
    assert review_report([review("a", "supported"), review("b", "supported")])["decisions"][0][
        "gold"
    ]
    conflicting = [review("a", "supported"), review("b", "unsupported")]
    assert not review_report(conflicting)["decisions"][0]["gold"]
    assert review_report(conflicting + [review("c", "supported", True)])["decisions"][0]["gold"]
    with pytest.raises(ValueError, match="terceiro"):
        review_report(conflicting + [review("a", "supported", True)])


def test_submission_recalculates_and_rejects_false_seal(items):
    item = next(i for i in items if i.track == "C")
    preds = [
        prediction(item, item.answer.value).model_copy(update={"variant": n}) for n in range(3)
    ]
    result = aggregate([item], preds)
    assert validate_submission([item], preds, result).complete
    with pytest.raises(ValueError):
        Result.model_validate({**result.model_dump(), "verification": "verificado"})
    changed = result.model_copy(deep=True)
    changed.metrics[0]["score"]["mean"] = 0
    with pytest.raises(ValueError, match="não corresponde"):
        validate_submission([item], preds, changed)


def test_read_only_api_and_cutoff(snapshot):
    client = TestClient(create_app(snapshot))
    assert client.get("/health").json()["records"] == 80
    assert client.get("/records", params={"q": "'; DROP TABLE records;--"}).json() == []
    row = client.get("/records/camara:votacao:fixture-0").json()
    assert "raw" not in row and "orientations" not in row
    assert client.post("/records", json={}).status_code == 405
    earlier = TestClient(create_app(snapshot, datetime(2026, 9, 4, tzinfo=UTC)))
    assert earlier.get("/records/camara:votacao:fixture-0").status_code == 404
    prop = earlier.get("/records/camara:proposicao:fixture-0").json()
    assert "text" not in prop and len(prop["history"]) == 1


def test_source_pagination_preserves_query(tmp_path):
    requests = []

    def handler(request):
        requests.append(str(request.url))
        page = request.url.params.get("pagina", "1")
        return httpx.Response(
            200,
            json={
                "dados": [{"id": page}],
                "links": [
                    {
                        "rel": "next",
                        "href": "https://dadosabertos.camara.leg.br/api/v2/votacoes?pagina=2&dataInicio=2026-09-01",
                    }
                ]
                if page == "1"
                else [],
            },
        )

    async def execute():
        collector = Collector(
            tmp_path,
            datetime(2026, 9, 1).date(),
            datetime(2026, 9, 30).date(),
            httpx.MockTransport(handler),
        )
        rows = await collector.camara_list("votacoes", {"dataInicio": "2026-09-01"})
        await collector.client.aclose()
        return rows

    assert asyncio.run(execute()) == [{"id": "1"}, {"id": "2"}]
    assert "pagina=2" in requests[1] and "dataInicio=2026-09-01" in requests[1]


def test_source_schema_and_ignored_dates(tmp_path):
    collector = Collector(tmp_path, datetime(2026, 9, 1).date(), datetime(2026, 9, 30).date())
    assert collector.in_window("senado", "url", [{"date": "2026-01-01"}], "date") == []
    assert collector.gaps[0]["required"]
    asyncio.run(collector.client.aclose())


def test_site_and_export_reject_hidden(items, tmp_path):
    hidden = items[0].model_copy(update={"split": "test-private"})
    assert "answer" not in public_question(hidden).model_dump()
    with pytest.raises(ValueError, match="ocultos"):
        export_dataset([hidden], tmp_path / "export")
    with pytest.raises(ValueError, match="oculto"):
        export_site([hidden], tmp_path / "results", tmp_path / "site")
