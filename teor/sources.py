"""As fontes preservam respostas oficiais; normalização nunca substitui uma lacuna por um fato."""

import asyncio
import hashlib
import json
import re
import subprocess
import sys
from datetime import UTC, date, datetime
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup

from teor.io import canonical, digest, read_json, write_json, write_jsonl
from teor.models import Snapshot, SnapshotFile

CAMARA = "https://dadosabertos.camara.leg.br/api/v2"
SENADO = "https://legis.senado.leg.br/dadosabertos"


class Collector:
    def __init__(self, output: Path, start: date, end: date, transport: Any = None):
        if end < start:
            raise ValueError("Intervalo de coleta inválido")
        self.output, self.start, self.end = output, start, end
        self.client = httpx.AsyncClient(
            timeout=90,
            follow_redirects=True,
            transport=transport,
            headers={
                "Accept": "application/json",
                "User-Agent": "Teor/1.0 (public legislative benchmark)",
            },
        )
        self.limits = {"camara": asyncio.Semaphore(2), "senado": asyncio.Semaphore(2)}
        self.gaps: list[dict[str, Any]] = []
        self.extractors = asyncio.Semaphore(2)
        self.files: dict[str, SnapshotFile] = {}

    def gap(self, chamber: str, url: str, reason: str, required: bool = True) -> None:
        self.gaps.append({"chamber": chamber, "url": url, "reason": reason, "required": required})

    async def fetch(
        self, chamber: str, url: str, params: dict[str, Any] | None = None, binary: bool = False
    ) -> Any:
        params = params or {}
        identity: dict[str, Any] = {"url": url, "params": params}
        if urlparse(url).query and not params:
            identity["query_protocol"] = 2
        key = digest(identity)
        path = self.output / "raw" / chamber / f"{key}.{'bin' if binary else 'json'}"
        meta = path.with_suffix(".meta.json")
        async with self.limits[chamber]:
            if path.exists() and meta.exists():
                entry = SnapshotFile.model_validate(read_json(meta))
                if hashlib.sha256(path.read_bytes()).hexdigest() != entry.sha256:
                    raise ValueError(f"Cache adulterado: {path}")
                self.files[str(path.relative_to(self.output)).replace("\\", "/")] = entry
                return path.read_bytes() if binary else read_json(path)
            for attempt in range(5):
                try:
                    # params={} remove a query já presente na URL em HTTPX; next links são completos.
                    response = await self.client.get(url, params=params or None)
                    if response.status_code in (429, 500, 502, 503, 504):
                        delay = response.headers.get("Retry-After", "")
                        if delay.isdigit():
                            seconds = float(delay)
                        else:
                            try:
                                seconds = max(
                                    0,
                                    (
                                        parsedate_to_datetime(delay) - datetime.now(UTC)
                                    ).total_seconds(),
                                )
                            except (ValueError, TypeError):
                                seconds = 2**attempt
                        await asyncio.sleep(seconds)
                        continue
                    response.raise_for_status()
                    value = response.content if binary else response.json()
                    content = value if binary else canonical(value)
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(content)
                    entry = SnapshotFile(
                        path=str(path.relative_to(self.output)).replace("\\", "/"),
                        sha256=hashlib.sha256(content).hexdigest(),
                        url=url,
                        params=params,
                        obtained_at=datetime.now(UTC),
                    )
                    write_json(meta, entry)
                    self.files[entry.path] = entry
                    return value
                except (httpx.HTTPError, ValueError) as exc:
                    if (
                        attempt == 4
                        or isinstance(exc, httpx.HTTPStatusError)
                        and exc.response.status_code < 500
                    ):
                        self.gap(chamber, url, str(exc))
                        return None
                    await asyncio.sleep(2**attempt)
            self.gap(chamber, url, "Retentativas esgotadas")
            return None

    async def camara_list(
        self, path: str, params: dict[str, Any] | None = None
    ) -> list[dict[str, Any]]:
        url, query = (
            f"{CAMARA}/{path}",
            {**({"itens": 100} if path in ("votacoes", "proposicoes") else {}), **(params or {})},
        )
        rows: list[dict[str, Any]] = []
        seen: set[str] = set()
        while url:
            payload = await self.fetch("camara", url, query)
            if payload is None:
                break
            if not isinstance(payload, dict) or "dados" not in payload:
                self.gap("camara", url, "Envelope dados ausente; schema alterado")
                break
            chunk = payload.get("dados", [])
            if not isinstance(chunk, list):
                self.gap("camara", url, "Lista esperada; schema alterado")
                break
            marker = digest(chunk)
            if chunk and marker in seen:
                self.gap("camara", url, "Página repetida")
                break
            seen.add(marker)
            rows.extend(chunk)
            next_url = next(
                (link["href"] for link in payload.get("links", []) if link.get("rel") == "next"), ""
            )
            if next_url and not next_url.startswith(CAMARA + "/"):
                self.gap("camara", url, "Paginação aponta para origem não autorizada")
                break
            url, query = next_url, {}
        return rows

    def in_window(
        self, chamber: str, url: str, rows: list[dict[str, Any]], field: str
    ) -> list[dict[str, Any]]:
        valid = []
        for row in rows:
            raw = row.get(field)
            try:
                value = date.fromisoformat(str(raw)[:10])
            except ValueError:
                self.gap(chamber, url, f"Registro sem data válida em {field}")
                continue
            if self.start <= value <= self.end:
                valid.append(row)
            else:
                self.gap(chamber, url, f"Filtro ignorado: {field}={raw}")
        return valid

    async def document(self, chamber: str, url: str | None) -> dict[str, Any] | None:
        if not url:
            return None
        host = urlparse(url).hostname or ""
        if not host.endswith((".leg.br", ".gov.br")):
            self.gap(chamber, url, "Documento fora das fontes oficiais", False)
            return None
        content = await self.fetch(chamber, url, binary=True)
        if content is None:
            return None
        content_hash = hashlib.sha256(content).hexdigest()
        extracted = self.output / "documents" / f"{content_hash}.json"
        extraction_meta = extracted.with_suffix(".meta.json")
        if extracted.exists() and extraction_meta.exists():
            entry = SnapshotFile.model_validate(read_json(extraction_meta))
            if hashlib.sha256(extracted.read_bytes()).hexdigest() != entry.sha256:
                raise ValueError("Texto extraído adulterado")
            self.files[entry.path] = entry
            cached = read_json(extracted)
            return {**cached, "url": url}
        try:
            if content.startswith(b"%PDF"):
                async with self.extractors:
                    parsed = await asyncio.to_thread(
                        subprocess.run,
                        [sys.executable, "-m", "teor.pdf"],
                        input=content,
                        capture_output=True,
                        timeout=60,
                        check=True,
                    )
                text = json.loads(parsed.stdout)["text"]
            else:
                soup = BeautifulSoup(content, "html.parser")
                for element in soup(["script", "style", "nav", "header", "footer"]):
                    element.decompose()
                text = soup.get_text("\n", strip=True)
            if len(text.strip()) < 40:
                self.gap(chamber, url, "Documento sem camada textual utilizável", False)
                return None
            result = {"url": url, "text": text, "sha256": content_hash}
            write_json(extracted, result)
            entry = SnapshotFile(
                path=str(extracted.relative_to(self.output)).replace("\\", "/"),
                sha256=hashlib.sha256(extracted.read_bytes()).hexdigest(),
                url=url,
            )
            write_json(extraction_meta, entry)
            self.files[entry.path] = entry
            return result
        except Exception as exc:
            self.gap(chamber, url, f"Extração de documento: {exc}", False)
            return None

    async def camara(self) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        voting = await self.camara_list(
            "votacoes", {"dataInicio": str(self.start), "dataFim": str(self.end)}
        )
        voting = self.in_window("camara", CAMARA + "/votacoes", voting, "data")
        props = await self.camara_list(
            "proposicoes",
            {"dataApresentacaoInicio": str(self.start), "dataApresentacaoFim": str(self.end)},
        )
        # A lista resumida não tem data: validamos o filtro no detalhe de cada ID descoberto.
        presented_ids = {str(row["id"]) for row in props}
        ids = {str(row["id"]) for row in props}
        votes: list[dict[str, Any]] = []

        async def vote(row: dict[str, Any]) -> None:
            ref = str(row["id"])
            detail = await self.fetch("camara", f"{CAMARA}/votacoes/{ref}")
            data = detail.get("dados", row) if detail else row
            for prop in data.get("proposicoesAfetadas", []) + data.get(
                "proposicoesRelacionadas", []
            ):
                if prop.get("id"):
                    ids.add(str(prop["id"]))
            object_url = data.get("uriProposicaoObjeto") or row.get("uriProposicaoObjeto")
            if object_url:
                ids.add(object_url.rstrip("/").split("/")[-1])
            nominal, orientation = await asyncio.gather(
                self.camara_list(f"votacoes/{ref}/votos"),
                self.camara_list(f"votacoes/{ref}/orientacoes"),
            )
            votes.append(
                {
                    "id": f"camara:votacao:{ref}",
                    "chamber": "camara",
                    "date": row["data"],
                    "url": f"{CAMARA}/votacoes/{ref}",
                    "raw": data,
                    "votes": [
                        {
                            "parliamentarian": str(v.get("deputado_", {}).get("id", "")),
                            "party": v.get("deputado_", {}).get("siglaPartido", ""),
                            "vote": v.get("tipoVoto", ""),
                        }
                        for v in nominal
                    ],
                    "orientations": orientation,
                    "result": "aprovada"
                    if data.get("aprovacao") == 1
                    else "rejeitada"
                    if data.get("aprovacao") == 0
                    else None,
                    "propositions": [
                        f"camara:proposicao:{p['id']}"
                        for p in data.get("proposicoesAfetadas", [])
                        + data.get("proposicoesRelacionadas", [])
                        if p.get("id")
                    ]
                    + (
                        [f"camara:proposicao:{object_url.rstrip('/').split('/')[-1]}"]
                        if object_url
                        else []
                    ),
                }
            )

        await asyncio.gather(*(vote(row) for row in voting))
        propositions: list[dict[str, Any]] = []

        async def proposition(ref: str) -> None:
            payload = await self.fetch("camara", f"{CAMARA}/proposicoes/{ref}")
            if payload is None:
                return
            data = payload["dados"]
            if ref in presented_ids:
                self.in_window("camara", f"{CAMARA}/proposicoes/{ref}", [data], "dataApresentacao")
            authors, themes, history = await asyncio.gather(
                *(
                    self.camara_list(f"proposicoes/{ref}/{suffix}")
                    for suffix in ("autores", "temas", "tramitacoes")
                )
            )
            doc = await self.document("camara", data.get("urlInteiroTeor"))
            propositions.append(
                {
                    "id": f"camara:proposicao:{ref}",
                    "chamber": "camara",
                    "date": str(data.get("dataApresentacao", ""))[:10],
                    "url": f"{CAMARA}/proposicoes/{ref}",
                    "type": data.get("siglaTipo", ""),
                    "text": data.get("ementa", ""),
                    "authors": [a.get("nome", "") for a in authors],
                    "themes": [t.get("tema", "") for t in themes],
                    "history": [
                        {
                            "date": h.get("dataHora"),
                            "body": h.get("siglaOrgao"),
                            "description": h.get("descricaoTramitacao"),
                        }
                        for h in history
                    ],
                    "document": doc,
                }
            )

        # Lotes limitam tarefas pendentes sem limitar a cobertura dos registros.
        for offset in range(0, len(ids), 20):
            await asyncio.gather(*(proposition(ref) for ref in sorted(ids)[offset : offset + 20]))
        return propositions, votes

    async def senado(self) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        processes = await self.fetch(
            "senado",
            f"{SENADO}/processo",
            {
                "dataInicioApresentacao": str(self.start),
                "dataFimApresentacao": str(self.end),
                "casa": "SF",
            },
        )
        sessions = await self.fetch(
            "senado", f"{SENADO}/votacao", {"dataInicio": str(self.start), "dataFim": str(self.end)}
        )
        if not isinstance(processes, list) or not isinstance(sessions, list):
            self.gap("senado", SENADO, "Schema de processo/votação deve ser lista")
            return [], []
        processes = self.in_window("senado", SENADO + "/processo", processes, "dataApresentacao")
        ids = {str(p["id"]) for p in processes}
        votes = []
        for session in sessions:
            if session.get("casaSessao") != "SF":
                continue
            process_id = session.get("idProcesso")
            if process_id:
                ids.add(str(process_id))
            ref = str(session["codigoSessaoVotacao"])
            votes.append(
                {
                    "id": f"senado:votacao:{ref}",
                    "chamber": "senado",
                    "date": session["dataSessao"],
                    "url": f"{SENADO}/votacao?codigoSessao={session['codigoSessao']}",
                    "raw": session,
                    "votes": [
                        {
                            "parliamentarian": str(v["codigoParlamentar"]),
                            "party": v.get("siglaPartidoParlamentar", ""),
                            "vote": v.get("siglaVotoParlamentar", ""),
                        }
                        for v in session.get("votos", [])
                        if session.get("votacaoSecreta") != "S"
                    ],
                    "secret": session.get("votacaoSecreta") == "S",
                    "counts": {
                        label: session[key]
                        for label, key in (
                            ("Sim", "totalVotosSim"),
                            ("Não", "totalVotosNao"),
                            ("Abstenção", "totalVotosAbstencao"),
                        )
                        if session.get(key) is not None
                    },
                    "orientations": [],
                    "result": {"A": "aprovada", "R": "rejeitada"}.get(
                        session.get("resultadoVotacao")
                    ),
                    "propositions": [f"senado:proposicao:{process_id}"] if process_id else [],
                }
            )
        votes = self.in_window("senado", SENADO + "/votacao", votes, "date")
        committees = await self.fetch("senado", f"{SENADO}/comissao/lista/colegiados")
        failed_committees = []
        if isinstance(committees, dict):
            colegiados = (
                committees.get("ListaColegiados", {}).get("Colegiados", {}).get("Colegiado", [])
            )
            if isinstance(colegiados, dict):
                colegiados = [colegiados]
            for committee in colegiados:
                if committee.get("SiglaCasa") != "SF" or committee.get("Publica") != "S":
                    continue
                committee_votes = await self.fetch(
                    "senado",
                    f"{SENADO}/votacaoComissao/comissao/{committee['Sigla']}",
                    {
                        "dataInicio": self.start.strftime("%Y%m%d"),
                        "dataFim": self.end.strftime("%Y%m%d"),
                    },
                )
                if committee_votes is None:
                    failed_committees.append(committee["Sigla"])
                # O serviço de comissões ainda usa o envelope XML/JSON legado; preservamos o bruto.
                found = normalize_committee_votes(committee_votes or {}, committee["Sigla"])
                votes.extend(self.in_window("senado", f"{SENADO}/votacaoComissao", found, "date"))
                for voting in found:
                    for prop_id in voting.get("propositions", []):
                        ids.add(prop_id.rsplit(":", 1)[-1])
        if failed_committees:
            alternative, proof = await self.committee_fallback()
            by_id = {v["id"]: v for v in votes}
            for voting in alternative:
                by_id.setdefault(voting["id"], voting)
            votes = sorted(by_id.values(), key=lambda v: v["id"])
            if proof:
                for gap in self.gaps:
                    if any(
                        gap["url"] == f"{SENADO}/votacaoComissao/comissao/{sigla}"
                        for sigla in failed_committees
                    ):
                        gap["required"] = False
                        gap["resolved_by"] = proof
        for voting in votes:
            label = voting.get("raw", {}).get("IdentificacaoMateria", "")
            match = re.fullmatch(r"([A-Z]+)\s+(\d+)/(\d{4})", label)
            if not match:
                continue
            kind, number, year = match.groups()
            processes_for_vote = await self.fetch(
                "senado",
                f"{SENADO}/processo",
                {"sigla": kind, "numero": number, "ano": int(year), "casa": "SF"},
            )
            exact = [p for p in processes_for_vote or [] if p.get("identificacao") == label]
            if len(exact) != 1:
                self.gap("senado", voting["url"], f"Relação processo/votação ambígua: {label}")
                continue
            process_id = str(exact[0]["id"])
            voting["propositions"] = [f"senado:proposicao:{process_id}"]
            ids.add(process_id)
        propositions = []

        async def proposition(ref: str) -> None:
            payload = await self.fetch("senado", f"{SENADO}/processo/{ref}")
            if not isinstance(payload, dict):
                self.gap("senado", f"{SENADO}/processo/{ref}", "Detalhe do processo não disponível")
                return
            initial = payload.get("documento", {})
            document = await self.document("senado", initial.get("url"))
            history = [
                {
                    "date": h.get("data"),
                    "body": h.get("colegiado", {}).get(
                        "sigla", h.get("enteAdministrativo", {}).get("sigla", "")
                    ),
                    "description": h.get("descricao", ""),
                }
                for autuation in payload.get("autuacoes", [])
                for h in autuation.get("informesLegislativos", [])
            ]
            propositions.append(
                {
                    "id": f"senado:proposicao:{ref}",
                    "chamber": "senado",
                    "date": str(initial.get("dataApresentacao", ""))[:10],
                    "url": f"{SENADO}/processo/{ref}",
                    "type": payload.get("sigla", ""),
                    "text": payload.get("conteudo", {}).get("ementa", ""),
                    "authors": [a.get("autor", "") for a in initial.get("autoria", [])],
                    "themes": [a.get("descricao", "") for a in payload.get("classificacoes", [])],
                    "history": history,
                    "document": document,
                }
            )

        for offset in range(0, len(ids), 20):
            await asyncio.gather(
                *(proposition(ref) for ref in sorted(ids)[offset : offset + 20] if ref)
            )
        return propositions, votes

    async def committee_fallback(self) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
        # A rota por sigla rejeita algumas siglas acentuadas; a rota oficial por parlamentar devolve o mesmo registro completo.
        current = await self.fetch("senado", f"{SENADO}/senador/lista/atual")
        legislatures: set[str] = set()

        def discover(value):
            if isinstance(value, list):
                for child in value:
                    discover(child)
            elif isinstance(value, dict):
                if (
                    {"NumeroLegislatura", "DataInicio", "DataFim"} <= value.keys()
                    and value["DataInicio"] <= str(self.start)
                    and value["DataFim"] >= str(self.end)
                ):
                    legislatures.add(str(value["NumeroLegislatura"]))
                for child in value.values():
                    discover(child)

        discover(current)
        if not legislatures:
            self.gap(
                "senado",
                f"{SENADO}/senador/lista/atual",
                "Não foi possível comprovar a legislatura do intervalo para a rota alternativa",
            )
            return [], None
        codes: set[str] = set()
        for legislature in sorted(legislatures):
            roster = await self.fetch(
                "senado", f"{SENADO}/senador/lista/legislatura/{legislature}", {"exercicio": "S"}
            )
            if not isinstance(roster, dict) or "ListaParlamentarLegislatura" not in roster:
                return [], None
            parliamentarians = (
                roster["ListaParlamentarLegislatura"]
                .get("Parlamentares", {})
                .get("Parlamentar", [])
            )
            if isinstance(parliamentarians, dict):
                parliamentarians = [parliamentarians]
            codes.update(
                str(p["IdentificacaoParlamentar"]["CodigoParlamentar"]) for p in parliamentarians
            )

        async def parliamentary(code):
            url = f"{SENADO}/votacaoComissao/parlamentar/{code}"
            payload = await self.fetch(
                "senado",
                url,
                {
                    "dataInicio": self.start.strftime("%Y%m%d"),
                    "dataFim": self.end.strftime("%Y%m%d"),
                },
            )
            if not isinstance(payload, dict) or "VotacoesComissao" not in payload:
                return None
            found = normalize_committee_votes(payload, "")
            for row in found:
                row["url"] = url
            return self.in_window("senado", url, found, "date")

        results = await asyncio.gather(*(parliamentary(code) for code in sorted(codes)))
        if not codes or any(result is None for result in results):
            return [], None
        rows = {row["id"]: row for result in results if result is not None for row in result}
        return list(rows.values()), {
            "endpoint": f"{SENADO}/votacaoComissao/parlamentar/{{codigo}}",
            "legislatures": sorted(legislatures),
            "parliamentarians": len(codes),
            "coverage": "Todos os parlamentares com exercício na legislatura; registros completos de votação nominal",
        }

    async def collect(self) -> Snapshot:
        if (self.output / "manifest.json").exists():
            manifest = Snapshot.model_validate(read_json(self.output / "manifest.json"))
            if manifest.state == "complete":
                verify_snapshot(self.output)
                return manifest
            raise ValueError("Snapshot selado incompleto: use --resume-from em outro destino")
        propositions, votes = [], []
        try:
            for chamber in ("camara", "senado"):
                props, voting = await getattr(self, chamber)()
                propositions.extend(props)
                votes.extend(voting)
        finally:
            await self.client.aclose()
        for name, rows in (("propositions", propositions), ("votes", votes)):
            path = self.output / "normalized" / f"{name}.jsonl"
            write_jsonl(path, sorted(rows, key=lambda row: row["id"]))
            self.files[str(path.relative_to(self.output)).replace("\\", "/")] = SnapshotFile(
                path=str(path.relative_to(self.output)).replace("\\", "/"),
                sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
            )
        queue = self.output / "normalized/documents-queue.jsonl"
        write_jsonl(
            queue,
            [
                g
                for g in self.gaps
                if "resolved_by" not in g
                and (not g["required"] or "documento" in g["url"] or "codteor" in g["url"])
            ],
        )
        self.files[str(queue.relative_to(self.output)).replace("\\", "/")] = SnapshotFile(
            path="normalized/documents-queue.jsonl",
            sha256=hashlib.sha256(queue.read_bytes()).hexdigest(),
        )
        coverage = {
            chamber: {
                "propositions": sum(p["chamber"] == chamber for p in propositions),
                "votes": sum(v["chamber"] == chamber for v in votes),
                "nominal_votes": sum(
                    v["chamber"] == chamber and bool(v["votes"]) and not v.get("secret", False)
                    for v in votes
                ),
                "secret_votes": sum(
                    v["chamber"] == chamber and v.get("secret", False) for v in votes
                ),
                "votes_without_nominal": sum(
                    v["chamber"] == chamber and not v["votes"] for v in votes
                ),
                "text_documents": sum(
                    p["chamber"] == chamber and bool(p.get("document")) for p in propositions
                ),
                "document_gaps": sum(
                    p["chamber"] == chamber and not p.get("document") for p in propositions
                ),
                "resolved_source_gaps": sum(
                    g["chamber"] == chamber and "resolved_by" in g for g in self.gaps
                ),
            }
            for chamber in ("camara", "senado")
        }
        manifest = Snapshot(
            id=digest(
                {
                    "start": str(self.start),
                    "end": str(self.end),
                    "hashes": sorted((f.path, f.sha256) for f in self.files.values()),
                }
            )[:24],
            start=self.start,
            end=self.end,
            state="incomplete" if any(g["required"] for g in self.gaps) else "complete",
            sources=[CAMARA, SENADO],
            files=sorted(self.files.values(), key=lambda f: f.path),
            coverage=coverage,
            gaps=sorted(self.gaps, key=canonical),
            created_at=datetime.now(UTC),
        )
        write_json(self.output / "manifest.json", manifest)
        return manifest


def verify_snapshot(root: Path) -> Snapshot:
    manifest = Snapshot.model_validate(read_json(root / "manifest.json"))
    resolved = root.resolve()
    for entry in manifest.files:
        path = (root / entry.path).resolve()
        if not path.is_relative_to(resolved):
            raise ValueError("Caminho fora do snapshot")
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != entry.sha256:
            raise ValueError(f"Hash divergente: {entry.path}")
    return manifest


def normalize_committee_votes(payload: dict[str, Any], committee: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []

    def walk(value: Any) -> None:
        if isinstance(value, list):
            for child in value:
                walk(child)
        elif isinstance(value, dict):
            if "DataHoraInicioReuniao" in value and "CodigoVotacao" in value:
                if value.get("SiglaCasaColegiado", "SF") != "SF":
                    return
                actual_committee = value.get("SiglaColegiado", committee)
                nominal = value.get("Votos", {}).get("Voto", [])
                if isinstance(nominal, dict):
                    nominal = [nominal]
                ref = str(value.get("CodigoVotacao", digest(value)[:16]))
                rows.append(
                    {
                        "id": f"senado:comissao:{actual_committee}:{ref}",
                        "chamber": "senado",
                        "date": value["DataHoraInicioReuniao"][:10],
                        "url": f"{SENADO}/votacaoComissao/comissao/{actual_committee}",
                        "related_event": f"senado:reuniao:{value['CodigoReuniao']}"
                        if value.get("CodigoReuniao")
                        else None,
                        "raw": value,
                        "votes": [
                            {
                                "parliamentarian": str(v.get("CodigoParlamentar", "")),
                                "party": v.get("SiglaPartidoParlamentar", ""),
                                "vote": {"S": "Sim", "N": "Não", "A": "Abstenção"}.get(
                                    v.get("QualidadeVoto"), v.get("QualidadeVoto", "")
                                ),
                            }
                            for v in nominal
                        ],
                        "result": None,
                        "counts": {
                            label: int(value[key])
                            for label, key in (
                                ("Sim", "TotalVotosSim"),
                                ("Não", "TotalVotosNao"),
                                ("Abstenção", "TotalVotosAbstencao"),
                            )
                            if value.get(key) is not None
                        },
                        "secret": False,
                        "orientations": [],
                        "propositions": [],
                    }
                )
            else:
                for child in value.values():
                    walk(child)

    walk(payload)
    return rows
