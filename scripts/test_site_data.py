"""A CI usa dados sintéticos; este script nunca é executado pelo workflow de publicação."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path("tests").resolve()))
from conftest import create_fixture_snapshot  # noqa: E402

from teor.build import build_dataset, load_items  # noqa: E402
from teor.site import export_site  # noqa: E402

create_fixture_snapshot(Path("data/ci-snapshot"))
build_dataset(Path("data/ci-snapshot"), Path("data/ci-benchmark"))
export_site(
    load_items(Path("data/ci-benchmark/test-public.jsonl")),
    Path("data/empty-results"),
    Path("site"),
)
