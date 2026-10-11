import asyncio
from datetime import date

import httpx
import pytest

from teor.sources import Collector, normalize_committee_votes


def test_committee_legacy_envelope_real_field_names():
    row = {
        "CodigoVotacao": "38935",
        "DataHoraInicioReuniao": "2026-09-24T09:05:00",
        "Votos": {
            "Voto": {
                "CodigoParlamentar": "5982",
                "SiglaPartidoParlamentar": "MDB",
                "QualidadeVoto": "S",
            }
        },
        "TotalVotosSim": "1",
        "TotalVotosNao": "0",
    }
    votes = normalize_committee_votes({"VotacoesComissao": {"Votacoes": {"Votacao": row}}}, "CCJ")
    assert len(votes) == 1 and votes[0]["votes"][0]["vote"] == "Sim"
    # Um placar não comprova o resultado: o serviço não fornece aprovação/rejeição neste envelope.
    assert votes[0]["result"] is None and votes[0]["propositions"] == []
    assert normalize_committee_votes({"VotacoesComissao": {"Metadados": {}}}, "CCJ") == []


def test_cache_integrity_and_retry_after(tmp_path, monkeypatch):
    calls = []
    sleeps = []

    def handler(request):
        calls.append(request)
        return (
            httpx.Response(429, headers={"Retry-After": "2"})
            if len(calls) == 1
            else httpx.Response(200, json={"dados": []})
        )

    async def sleep(seconds):
        sleeps.append(seconds)

    monkeypatch.setattr(asyncio, "sleep", sleep)

    async def collect():
        client = Collector(
            tmp_path, date(2026, 9, 1), date(2026, 9, 30), httpx.MockTransport(handler)
        )
        await client.camara_list("votacoes")
        await client.camara_list("votacoes")
        cached = next((tmp_path / "raw/camara").glob("*.json"))
        while cached.name.endswith(".meta.json"):
            cached = next(
                p
                for p in (tmp_path / "raw/camara").glob("*.json")
                if not p.name.endswith(".meta.json")
            )
        cached.write_text("{}")
        with pytest.raises(ValueError, match="adulterado"):
            await client.camara_list("votacoes")
        await client.client.aclose()

    asyncio.run(collect())
    assert len(calls) == 2 and sleeps == [2]


def test_repeated_page_and_child_filters(tmp_path):
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(
            200,
            json={
                "dados": [{"id": 1}],
                "links": [
                    {
                        "rel": "next",
                        "href": "https://dadosabertos.camara.leg.br/api/v2/votacoes?pagina=2",
                    }
                ],
            },
        )

    async def collect():
        client = Collector(
            tmp_path, date(2026, 9, 1), date(2026, 9, 30), httpx.MockTransport(handler)
        )
        await client.camara_list("proposicoes/1/autores")
        await client.client.aclose()
        assert any(g["reason"] == "Página repetida" for g in client.gaps)

    asyncio.run(collect())
    assert not seen[0].url.params


def test_committee_fallback_covers_entire_official_roster(tmp_path):
    requested = []

    def handler(request):
        requested.append(str(request.url))
        path = request.url.path
        if path.endswith("/senador/lista/atual"):
            payload = {
                "legislatura": {
                    "NumeroLegislatura": "57",
                    "DataInicio": "2023-02-01",
                    "DataFim": "2027-01-31",
                }
            }
        elif path.endswith("/senador/lista/legislatura/57"):
            assert request.url.params["exercicio"] == "S"
            payload = {
                "ListaParlamentarLegislatura": {
                    "Parlamentares": {
                        "Parlamentar": [
                            {"IdentificacaoParlamentar": {"CodigoParlamentar": str(c)}}
                            for c in (1, 2)
                        ]
                    }
                }
            }
        elif "/votacaoComissao/parlamentar/" in path:
            assert request.url.params["dataInicio"] == "20260901"
            payload = {
                "VotacoesComissao": {
                    "Votacoes": {
                        "Votacao": [
                            {
                                "CodigoVotacao": "9",
                                "DataHoraInicioReuniao": "2026-09-05T10:00:00",
                                "SiglaColegiado": "CTBOLÍVIA",
                                "SiglaCasaColegiado": "SF",
                                "Votos": {"Voto": {"CodigoParlamentar": "1", "QualidadeVoto": "S"}},
                            }
                        ]
                    }
                }
            }
        else:
            raise AssertionError(path)
        return httpx.Response(200, json=payload)

    async def fallback():
        collector = Collector(
            tmp_path, date(2026, 9, 1), date(2026, 9, 30), httpx.MockTransport(handler)
        )
        rows, proof = await collector.committee_fallback()
        await collector.client.aclose()
        return rows, proof

    rows, proof = asyncio.run(fallback())
    assert len(rows) == 1 and rows[0]["id"] == "senado:comissao:CTBOLÍVIA:9"
    assert proof["parliamentarians"] == 2 and proof["legislatures"] == ["57"]
    assert len(requested) == 4
