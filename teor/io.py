"""A serialização canônica permite comparar conteúdo sem depender do sistema operacional."""

import hashlib
import json
import os
import shutil
import tempfile
from datetime import date, datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel

CANARY = "TEOR-BENCHMARK-NOT-FOR-TRAINING-2026"


def immutable_cache_copy(source: str, destination: str) -> str:
    # Cache selado nunca é editado; links evitam duplicar gigabytes a cada retomada. Escritas novas são atômicas.
    try:
        os.link(source, destination)
    except OSError:
        shutil.copy2(source, destination)
    return destination


def canonical(value: Any) -> bytes:
    if isinstance(value, BaseModel):
        value = value.model_dump(mode="json")

    def encode(obj: Any) -> Any:
        if isinstance(obj, BaseModel):
            return obj.model_dump(mode="json")
        if isinstance(obj, (date, datetime)):
            return obj.isoformat()
        if isinstance(obj, Path):
            return str(obj)
        raise TypeError(f"Tipo não canônico: {type(obj)}")

    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
        default=encode,
    ).encode("utf-8")


def digest(value: Any) -> str:
    return hashlib.sha256(canonical(value)).hexdigest()


def write_json(path: Path, value: Any) -> None:
    atomic_write(path, canonical(value) + b"\n")


def atomic_write(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # Um checkpoint incompleto pode cobrar o mesmo lote de novo; substituímos somente após fsync.
    with tempfile.NamedTemporaryFile(
        dir=path.parent, prefix=f".{path.name}.", delete=False
    ) as stream:
        temporary = Path(stream.name)
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())
    try:
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_jsonl(path: Path, rows: list[Any]) -> None:
    atomic_write(path, b"".join(canonical(row) + b"\n" for row in rows))


def read_jsonl(path: Path) -> list[Any]:
    return [
        json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()
    ]
