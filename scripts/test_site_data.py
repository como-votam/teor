"""A CI usa dados sintéticos; este script nunca é executado pelo workflow de publicação."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path("tests").resolve()))
from conftest import create_fixture_snapshot  # noqa: E402

from teor.build import build_dataset, load_items  # noqa: E402
from teor.site import export_site  # noqa: E402

snapshot = create_fixture_snapshot(Path("data/ci-snapshot"))
# A API usa outro UID no container; só a fixture pública ganha leitura compartilhada.
# Arquivos operacionais e gabaritos continuam com as permissões restritas da escrita atômica.
snapshot.chmod(0o755)
for path in snapshot.rglob("*"):
    path.chmod(0o755 if path.is_dir() else 0o644)
build_dataset(snapshot, Path("data/ci-benchmark"))
export_site(
    load_items(Path("data/ci-benchmark/test-public.jsonl")),
    Path("data/empty-results"),
    Path("site"),
)
