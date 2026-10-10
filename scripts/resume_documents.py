"""A retomada pode reutilizar texto já extraído, desde que o snapshot e o PDF sejam verificáveis."""

import hashlib
import sys
from pathlib import Path

from teor.io import read_jsonl, write_json
from teor.models import SnapshotFile
from teor.sources import verify_snapshot

source, destination = map(Path, sys.argv[1:3])
verify_snapshot(source)
count = 0
for proposition in read_jsonl(source / "normalized/propositions.jsonl"):
    document = proposition.get("document")
    if not document:
        continue
    path = destination / "documents" / f"{document['sha256']}.json"
    write_json(path, document)
    write_json(
        path.with_suffix(".meta.json"),
        SnapshotFile(
            path=f"documents/{path.name}",
            sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
            url=document["url"],
        ),
    )
    count += 1
print(f"{count} extrações recuperadas; reutilização exige o mesmo SHA-256 do documento bruto")
