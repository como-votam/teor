from datetime import UTC, datetime

import pytest

from teor.io import digest
from teor.models import Prediction, Review
from teor.operations import attach_human_reviews, validate_submission
from teor.scoring import aggregate


def test_citation_presence_does_not_replace_human_judgement(items):
    item = next(i for i in items if i.track == "F")
    document = item.context["documents"][0]
    prediction = Prediction(
        item_id=item.id,
        variant=0,
        run_id="test",
        model="mock",
        response={
            "claims": [
                {
                    "text": "Afirmação falsa no exemplo de teste",
                    "ref": document["ref"],
                    "quote": document["text"][:20],
                }
            ]
        },
    )
    automatic = aggregate([item], [prediction])
    assert automatic.metrics[0]["citation_validity"]["mean"] == 1
    assert "score" not in automatic.metrics[0]
    reviews = [
        Review(
            item_id=item.id,
            item_hash=digest(item),
            reviewer=r,
            judgement="unsupported",
            evidence="A citação não sustenta a afirmação",
            prediction_id=f"test:{item.id}:0",
            claim_index=0,
            reviewed_at=datetime.now(UTC),
        )
        for r in ("a", "b")
    ]
    human = attach_human_reviews([item], [prediction], automatic, reviews)
    assert human.metrics[0]["human_fidelity"]["mean"] == 0
    assert human.metrics[0]["human_review_coverage"]["coverage"] == 1
    assert (
        validate_submission([item], [prediction], human, reviews=reviews).metrics == human.metrics
    )
    reviews[0].item_hash = "old-version"
    with pytest.raises(ValueError, match="versão"):
        attach_human_reviews([item], [prediction], automatic, reviews)
