# Entrega local — setembro de 2026

O projeto está implementado em `teor/`, com coleta, geração das trilhas A–H, avaliação, curadoria, rodadas, submissões e site integrados. A entrega não executou commits, pushes, PRs, releases ou publicação de artefatos.

## Coleta real

O snapshot final é `data/setembro-2026-final`, identificado por `b11ef9ec73a12bb2bc7ca8a1`. Seu manifesto registra estado `complete`, os arquivos e hashes, as URLs consultadas e as exceções encontradas. O período cobre 1º a 30 de setembro, incluindo proposições anteriores relacionadas às votações do mês.

| Fonte | Proposições | Votações | Com votos nominais públicos | Documentos com texto | Lacunas documentais |
|---|---:|---:|---:|---:|---:|
| Câmara | 2.062 | 303 | 3 | 2.060 | 2 |
| Senado | 241 | 10 | 9 | 227 | 14 |
| Total | 2.303 | 313 | 12 | 2.287 | 16 |

As 300 votações da Câmara sem votos nominais não foram transformadas em votos individuais. Uma votação secreta do Senado conserva o placar oficial, sem atribuir escolhas aos participantes.

Duas rotas de comissões do Senado responderam 404. A cobertura foi recuperada pela rota oficial de votações em comissões por parlamentar, consultando os 126 parlamentares com exercício na legislatura identificada pela fonte. O manifesto conserva a falha original e a evidência de resolução. Essas duas ocorrências não integram a fila dos 16 documentos sem texto utilizável. O estado completo indica cobertura dos registros oferecidos pelos serviços consultados; não elimina as limitações de publicação das fontes.

Versões anteriores da coleta foram preservadas como diagnóstico. Use o snapshot final para reproduzir esta entrega.

## Artefatos gerados

Foram gerados 27.647 itens elegíveis, preservados no banco local `data/benchmark/private/eligible-items.jsonl`. Os limites acordados selecionaram famílias inteiras; os demais itens continuam disponíveis para configurações maiores.

| Divisão | Itens | Famílias |
|---|---:|---:|
| dev | 2.287 | 200 |
| test-public | 3.000 | 97 |
| test-lite, subconjunto público | 500 | 89 |
| test-private | 2.513 | 224 |

O conjunto público contém A: 860, B: 8, C: 458, D: 536, E: 970, F: 127, G: 11 e H: 30 itens; são 2.292 da Câmara e 708 do Senado. Cada item contém três variantes de prompt. A distribuição acompanha a elegibilidade das fontes, sem preencher estratos com exemplos inventados. O manifesto de construção informa a cobertura das demais divisões e os limites aplicados.

Os baselines aleatório, classe majoritária estimada em dev e BM25 produziram 9.000 previsões cada, com relatórios em `results/baseline-*.json`. Esses resultados não representam avaliações de LLMs. Orientações partidárias não foram usadas como baseline: a coleta atual não comprova sua disponibilidade antes dos cortes de previsão. As tarefas E disponíveis são retrospectivas, identificadas como tal.

Há 400 candidatos à revisão em `private/gold-candidates`; nenhum recebeu selo ouro. F apresenta verificação de citações e aguarda revisão humana para fidelidade semântica. O site exportado contém somente dados públicos, dez perguntas de quiz e previsões para comparar exatamente esses itens. O pacote em `exports/huggingface` está preparado para publicação posterior.

## Verificação e reprodução

A rotina abaixo verifica todos os hashes, constrói o benchmark duas vezes e compara os manifests, repete os baselines e exporta os artefatos públicos. Ela usa os dados locais, sem chamadas a modelos:

```powershell
uv sync --frozen --all-extras --group dev
uv run python scripts/acceptance.py data/setembro-2026-final
uv run pytest -q
uv run ruff check teor tests scripts
uv run ruff format --check teor tests scripts
uv run mypy teor
uv run python scripts/check_schemas.py
uv run python scripts/validate_results.py
uv run python scripts/check_secrets.py
uv run python scripts/run_notebooks.py
cd site
npm ci
npm run test
npm run build
npm run test:e2e
npm run preview -- --host 127.0.0.1
```

O relatório detalhado está em `reports/acceptance.json`. Dados brutos, relatórios operacionais, caches, previsões locais e gabaritos privados estão ignorados pelo Git. As previsões completas dos baselines ficam em `data/baselines/`; os JSONs de resultados contêm métricas e proveniência.

Verificação final: 44 testes Python, três testes unitários do site e 12 testes de navegador aprovados; seis notebooks executados; lint, tipos, schemas, determinismo e validação de resultados aprovados. O build gerou 14 páginas sem erros ou avisos, e `npm audit` não encontrou vulnerabilidades. O resumo está em `reports/validation.json`.

Os testes Python cobrem os scorers, o agrupamento e os cortes, a coleta e a recuperação de fontes, os seis adaptadores batch, a execução Inspect com modelos simulados, a API, a revisão e as versões. Os testes de navegador cobrem navegação, acessibilidade com axe, filtros, carregamento de Parquet e quiz em desktop e celular. O wheel foi exercitado fora do checkout, e o container foi construído com usuário sem privilégios e snapshot montado somente para leitura.

## Repositório remoto e atividades externas

As configurações permitidas foram aplicadas somente em `como-votam/teor`: descrição, homepage, tópicos, Issues, Discussions, proteções de segurança disponíveis, permissões mínimas de Actions, ruleset de `main` e Pages por Actions. O relatório antes/depois está em `reports/github-apply-final.json`. A branch permanece sem commits; os workflows e templates existem apenas na cópia local. A configuração de Pages não publicou o site.

Ainda exigem execução externa: avaliações reais de modelos e serviços cloud, revisão humana, publicação em HF/PyPI/Pages e DNS. Os adaptadores cloud passaram por testes de contrato com SDKs e respostas simuladas; não foram testados com jobs faturáveis. CodeQL e os workflows remotos poderão executar após um primeiro push, que não foi feito nesta entrega. Não há artigo científico, parceria acadêmica ou validação institucional presumida.
