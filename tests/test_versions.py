from datetime import UTC, datetime

import pytest

from teor.io import digest, read_jsonl
from teor.models import Review
from teor.operations import apply_errata, promote_gold
from teor.scoring import score_one


def test_old_reviews_do_not_promote_corrected_answers(items, tmp_path):
    item = next(i for i in items if i.track == "C" and i.task == "yes_count")
    reviews = [
        Review(
            item_id=item.id,
            item_hash=digest(item),
            reviewer=r,
            judgement="supported",
            evidence="Fonte e trecho",
            reviewed_at=datetime.now(UTC),
        )
        for r in ("a", "b")
    ]
    assert promote_gold([item], reviews, tmp_path / "gold-original")["items"] == 1
    correction = {
        "item_id": item.id,
        "old_item_hash": digest(item),
        "reason": "Correção sintética exclusiva deste teste",
        "url": "https://example.org/fixture",
        "answer": {"type": "integer", "value": 3},
    }
    apply_errata([item], [correction], tmp_path / "revised")
    from teor.models import Item

    changed = Item.model_validate(read_jsonl(tmp_path / "revised/items.jsonl")[0])
    assert promote_gold([changed], reviews, tmp_path / "gold-revised")["items"] == 0
    assert item.answer.value == 1 and changed.answer.value == 3
    with pytest.raises(ValueError, match="destino novo"):
        apply_errata([item], [correction], tmp_path / "revised")


def test_sequence_preserves_order(items):
    from teor.models import Prediction

    item = next(i for i in items if i.answer.type == "sequence")

    def pred(value):
        return Prediction(item_id=item.id, variant=0, run_id="test", model="test", response=value)

    assert score_one(item, pred(item.answer.value))["score"] == 1
    assert score_one(item, pred(list(reversed(item.answer.value))))["score"] == 0
