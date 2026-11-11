"""Servidor MCP mínimo (stdio) que expõe só `snapshot_record` sobre a API congelada do Teor.

É o único caminho de dados que um agente avaliado na trilha G recebe: leitura de um registro por id,
sem SQL, sem arquivos locais e sem o gabarito.
"""

import argparse
import json
import sys
from typing import Any

import httpx

from teor.runner import clean_record_id

TOOL = {
    "name": "snapshot_record",
    "description": "Consulta um registro oficial do snapshot congelado pelo identificador qualificado.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "record_id": {
                "type": "string",
                "description": "Identificador qualificado da proposição ou votação.",
            }
        },
        "required": ["record_id"],
        "additionalProperties": False,
    },
}


def fetch(api_url: str, record_id: str) -> str:
    record_id = clean_record_id(record_id)
    try:
        response = httpx.get(f"{api_url.rstrip('/')}/records/{record_id}", timeout=30)
        response.raise_for_status()
        return response.text
    except (httpx.InvalidURL, httpx.HTTPStatusError) as error:
        return f"Erro: identificador de registro inválido ({type(error).__name__})"


def handle(message: dict[str, Any], api_url: str) -> dict[str, Any] | None:
    method, ident = message.get("method"), message.get("id")
    if ident is None:
        return None
    if method == "initialize":
        version = (message.get("params") or {}).get("protocolVersion", "2024-11-05")
        result: dict[str, Any] = {
            "protocolVersion": version,
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "teor", "version": "1.0"},
        }
    elif method == "tools/list":
        result = {"tools": [TOOL]}
    elif method == "tools/call":
        params = message.get("params") or {}
        if params.get("name") != TOOL["name"]:
            return {
                "jsonrpc": "2.0",
                "id": ident,
                "error": {"code": -32602, "message": "ferramenta desconhecida"},
            }
        text = fetch(api_url, str((params.get("arguments") or {}).get("record_id", "")))
        result = {"content": [{"type": "text", "text": text}]}
    elif method == "ping":
        result = {}
    else:
        return {
            "jsonrpc": "2.0",
            "id": ident,
            "error": {"code": -32601, "message": "método desconhecido"},
        }
    return {"jsonrpc": "2.0", "id": ident, "result": result}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-url", required=True)
    args = parser.parse_args()
    for line in sys.stdin:
        if not line.strip():
            continue
        reply = handle(json.loads(line), args.api_url)
        if reply is not None:
            sys.stdout.write(json.dumps(reply) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
