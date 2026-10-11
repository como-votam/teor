import asyncio
from datetime import date

import httpx

from teor.io import read_jsonl
from teor.sources import Collector, verify_snapshot


def test_full_collection_both_houses_secret_counts_and_documents(tmp_path):
    def handler(request):
        url = str(request.url)
        path = request.url.path
        if path.endswith("/document.html"):
            return httpx.Response(
                200,
                text="<html><body>Documento oficial sintético, suficientemente longo para exercitar a extração de texto e seu cache local.</body></html>",
            )
        if "/api/v2/" in path:
            endpoint = path.split("/api/v2/")[1]
            values = {
                "proposicoes": [{"id": 1}],
                "votacoes": [{"id": "10", "data": "2026-09-05"}],
                "votacoes/10": {"id": "10", "aprovacao": 1, "proposicoesAfetadas": [{"id": 1}]},
                "votacoes/10/votos": [
                    {"deputado_": {"id": 1, "siglaPartido": "PT"}, "tipoVoto": "Sim"}
                ],
                "votacoes/10/orientacoes": [],
                "proposicoes/1": {
                    "id": 1,
                    "dataApresentacao": "2026-09-03",
                    "siglaTipo": "PL",
                    "ementa": "Ementa sintética da Câmara",
                    "urlInteiroTeor": "https://www.camara.leg.br/document.html",
                },
                "proposicoes/1/autores": [{"nome": "Autora"}],
                "proposicoes/1/temas": [{"tema": "Saúde"}],
                "proposicoes/1/tramitacoes": [],
            }
            assert endpoint in values, url
            return httpx.Response(200, json={"dados": values[endpoint], "links": []})
        if path.endswith("/processo"):
            return httpx.Response(200, json=[{"id": 42, "dataApresentacao": "2026-09-04"}])
        if path.endswith("/votacao"):
            return httpx.Response(
                200,
                json=[
                    {
                        "codigoSessaoVotacao": 12,
                        "codigoSessao": 1,
                        "idProcesso": 42,
                        "dataSessao": "2026-09-06",
                        "casaSessao": "SF",
                        "resultadoVotacao": "A",
                        "votacaoSecreta": "S",
                        "totalVotosSim": 63,
                        "totalVotosNao": 4,
                        "votos": [{"codigoParlamentar": 8, "siglaVotoParlamentar": "Votou"}],
                    }
                ],
            )
        if path.endswith("/comissao/lista/colegiados"):
            return httpx.Response(
                200,
                json={
                    "ListaColegiados": {
                        "Colegiados": {
                            "Colegiado": [{"SiglaCasa": "SF", "Publica": "S", "Sigla": "CCJ"}]
                        }
                    }
                },
            )
        if path.endswith("/comissao/CCJ"):
            return httpx.Response(200, json={"VotacoesComissao": {"Metadados": {}}})
        if path.endswith("/processo/42"):
            return httpx.Response(
                200,
                json={
                    "id": 42,
                    "sigla": "PL",
                    "conteudo": {"ementa": "Ementa sintética do Senado"},
                    "documento": {
                        "dataApresentacao": "2026-09-04",
                        "autoria": [{"autor": "Autor"}],
                        "url": "https://legis.senado.leg.br/document.html",
                    },
                    "autuacoes": [],
                },
            )
        raise AssertionError(url)

    async def collect():
        return await Collector(
            tmp_path, date(2026, 9, 1), date(2026, 9, 30), httpx.MockTransport(handler)
        ).collect()

    manifest = asyncio.run(collect())
    assert manifest.state == "complete"
    assert verify_snapshot(tmp_path).id == manifest.id
    votes = read_jsonl(tmp_path / "normalized/votes.jsonl")
    secret = next(v for v in votes if v["chamber"] == "senado")
    assert secret["votes"] == [] and secret["counts"]["Sim"] == 63
    assert manifest.coverage["senado"]["secret_votes"] == 1
    assert len(read_jsonl(tmp_path / "normalized/propositions.jsonl")) == 2
    assert (tmp_path / "normalized/documents-queue.jsonl").exists()
    from teor.build import generators

    items = generators(read_jsonl(tmp_path / "normalized/propositions.jsonl"), votes, [])
    assert not any(i.chamber == "senado" and i.task == "individual_yes" for i in items)
    assert any(
        i.chamber == "senado" and i.task == "official_tally" and i.answer.value == 63 for i in items
    )
