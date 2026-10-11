"""O wheel deve funcionar fora do checkout, inclusive com regras e materiais de curadoria."""

import os
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
wheel = next((ROOT / "dist").glob("*.whl"))
target = ROOT / "reports/wheel-installed"
with zipfile.ZipFile(wheel) as archive:
    if any(
        not (target / name).resolve().is_relative_to(target.resolve())
        for name in archive.namelist()
    ):
        raise ValueError("Wheel contém caminho fora do pacote")
    archive.extractall(target)
sys.path.insert(0, str(ROOT / "tests"))
from conftest import create_fixture_snapshot  # noqa: E402

with tempfile.TemporaryDirectory(prefix="teor-wheel-") as temporary:
    snapshot = create_fixture_snapshot(Path(temporary) / "snapshot")
    env = {**os.environ, "PYTHONPATH": str(target)}
    code = "from pathlib import Path; import teor; from teor.build import build_dataset,load_items,export_dataset; from teor.operations import export_reviews; assert 'wheel-installed' in teor.__file__; build_dataset(Path('snapshot'),Path('built')); items=load_items(Path('built/test-public.jsonl')); export_dataset(items,Path('export')); export_reviews(items,Path('review')); print('Wheel: build, export e curadoria fora do checkout aprovados')"
    subprocess.run([sys.executable, "-c", code], cwd=temporary, env=env, check=True)
