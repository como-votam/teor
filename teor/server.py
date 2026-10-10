"""A API expõe uma projeção congelada de registros, sem SQL arbitrário ou arquivos locais."""

from datetime import UTC, datetime
from pathlib import Path
from threading import RLock
from typing import Any

import duckdb
from fastapi import FastAPI, HTTPException, Query

from teor.io import canonical, read_jsonl
from teor.sources import verify_snapshot


def projected_records(root: Path, cutoff: datetime | None = None) -> list[dict[str, Any]]:
    verify_snapshot(root)
    records = []
    for kind in ("propositions", "votes"):
        for row in read_jsonl(root / "normalized" / f"{kind}.jsonl"):
            # Projeção por allowlist: respostas brutas podem conter dados pessoais dispensáveis.
            allowed = (
                (
                    "id",
                    "chamber",
                    "date",
                    "url",
                    "type",
                    "text",
                    "authors",
                    "themes",
                    "history",
                    "document",
                )
                if kind == "propositions"
                else ("id", "chamber", "date", "url", "votes", "result", "counts", "secret")
            )
            record = {k: row.get(k) for k in allowed}
            if cutoff:
                if datetime.fromisoformat(row["date"][:10]).replace(tzinfo=UTC) >= cutoff:
                    continue
                if kind == "propositions":
                    record = {k: row.get(k) for k in ("id", "chamber", "date")}
                    record["history"] = [
                        h
                        for h in row.get("history", [])
                        if h.get("date")
                        and datetime.fromisoformat(h["date"].replace(" ", "T")).replace(tzinfo=UTC)
                        < cutoff
                    ]
            records.append(record)
    return records


def create_app(root: Path, cutoff: datetime | None = None) -> FastAPI:
    rows = projected_records(root, cutoff)
    db = duckdb.connect()
    db.execute("CREATE TABLE records(id VARCHAR PRIMARY KEY, chamber VARCHAR, body VARCHAR)")
    db.executemany(
        "INSERT INTO records VALUES (?, ?, ?)",
        [(r["id"], r["chamber"], canonical(r).decode()) for r in rows],
    )
    app = FastAPI(title="Teor — API congelada", version="1.0")
    lock = RLock()

    @app.get("/health")
    def health() -> dict[str, Any]:
        return {"status": "ok", "records": len(rows), "cutoff": cutoff}

    @app.get("/records")
    def search(
        q: str = Query(default="", max_length=200),
        chamber: str | None = None,
        limit: int = Query(default=20, ge=1, le=100),
    ) -> list[dict[str, Any]]:
        import json

        with lock:
            result = db.execute(
                "SELECT body FROM records WHERE contains(lower(body), lower(?)) AND (? IS NULL OR chamber = ?) ORDER BY id LIMIT ?",
                [q, chamber, chamber, limit],
            ).fetchall()
        return [json.loads(row[0]) for row in result]

    @app.get("/records/{record_id}")
    def record(record_id: str) -> dict[str, Any]:
        import json

        with lock:
            result = db.execute("SELECT body FROM records WHERE id = ?", [record_id]).fetchone()
        if result is None:
            raise HTTPException(404, "Registro não encontrado")
        return json.loads(result[0])

    return app
