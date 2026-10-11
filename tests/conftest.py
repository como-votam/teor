"""Exemplos sintéticos são exclusivos dos testes e nunca entram no leaderboard."""

import hashlib
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import pytest

from teor.build import generators
from teor.io import write_json, write_jsonl
from teor.models import Snapshot, SnapshotFile


def fixture_records(count: int = 40) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    props, votes = [], []
    for n in range(count):
        chamber = "camara" if n % 2 == 0 else "senado"
        prop_id = f"{chamber}:proposicao:fixture-{n}"
        props.append(
            {
                "id": prop_id,
                "chamber": chamber,
                "date": "2026-09-03",
                "url": "https://example.org/fixture",
                "type": "PL",
                "text": f"Proposição sintética {n}. Altera a Lei nº 1.234, de 2000.",
                "authors": ["Autora de teste"],
                "themes": ["Tema de teste"],
                "history": [
                    {"date": "2026-09-03", "body": "CCJ", "description": "Recebida"},
                    {"date": "2026-09-04", "body": "PLEN", "description": "Distribuída"},
                ],
                "document": None,
            }
        )
        votes.append(
            {
                "id": f"{chamber}:votacao:fixture-{n}",
                "chamber": chamber,
                "date": "2026-09-05",
                "url": "https://example.org/fixture-vote",
                "votes": [
                    {"parliamentarian": "1", "party": "PT", "vote": "Sim"},
                    {"parliamentarian": "2", "party": "PL", "vote": "Não"},
                ],
                "result": "aprovada" if n % 3 else "rejeitada",
                "propositions": [prop_id],
            }
        )
    return props, votes


def create_fixture_snapshot(root: Path, count: int = 40) -> Path:
    props, votes = fixture_records(count)
    files = []
    for name, rows in (("propositions", props), ("votes", votes)):
        relative = f"normalized/{name}.jsonl"
        write_jsonl(root / relative, rows)
        files.append(
            SnapshotFile(
                path=relative, sha256=hashlib.sha256((root / relative).read_bytes()).hexdigest()
            )
        )
    write_json(
        root / "manifest.json",
        Snapshot(
            id="synthetic-fixture",
            start=date(2026, 9, 1),
            end=date(2026, 9, 30),
            state="complete",
            sources=["https://example.org/fixture"],
            files=files,
            coverage={},
            gaps=[],
            created_at=datetime(2026, 10, 9, tzinfo=UTC),
        ),
    )
    return root


@pytest.fixture
def snapshot(tmp_path: Path) -> Path:
    return create_fixture_snapshot(tmp_path / "snapshot")


@pytest.fixture
def items():
    props, votes = fixture_records(1)
    from teor.io import read_json

    return generators(props, votes, read_json(Path("config/rules.json")))
