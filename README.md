# Teor

Benchmark aberto de LLMs sobre o processo legislativo brasileiro, por [Como Votam](https://comovotam.com.br).

O Teor separa compreensão factual, previsão e uso de ferramentas. Publica métricas por trilha; não transforma tarefas diferentes em uma nota única. Gabaritos vêm de fontes oficiais. Fidelidade semântica depende de revisão humana.

## Começar

```powershell
python -m pip install uv
uv sync --extra eval --group dev
uv run teor --help
uv run teor collect --start 2026-09-01 --end 2026-09-30 --output data/setembro-2026
uv run teor snapshot verify data/setembro-2026
uv run teor build data/setembro-2026 --output data/benchmark
uv run teor validate data/benchmark/items.jsonl
uv run teor baseline data/benchmark/test-public.jsonl --dev data/benchmark/dev.jsonl --output data/random.jsonl
uv run teor score data/benchmark/test-public.jsonl data/random.jsonl --output reports/random.json
uv run teor site export data/benchmark/test-public.jsonl --results results --output site
cd site
npm ci
npm run build
```

Use `uv run` em todos os comandos Python. Para modelos, instale o extra do provedor: `uv sync --extra eval --extra anthropic`. `teor run --help` mostra os limites obrigatórios de orçamento e o arquivo de preços. Avaliação offline e construção dos dados não exigem chaves.

## Ler antes de comparar

- [Entrega local](docs/entrega.md): coleta real, artefatos, verificações e atividades externas pendentes.
- [Metodologia](docs/metodologia.md): tarefas, splits, pontuação e evidência temporal.
- [CLI e reprodução](docs/cli.md): comandos e artefatos.
- [Provedores e lotes](docs/provedores.md): capacidades e recursos cloud.
- [Curadoria e rodadas](docs/operacao.md): revisão, gabaritos ocultos e submissões.
- [Dataset card](docs/dataset-card.md): fontes, atribuição e limites de reuso.

Dados brutos, previsões locais e gabaritos privados não entram no Git. O site publica somente artefatos exportados explicitamente. O código não reutiliza implementação ou credenciais do produto Como Votam.

## Situação

O repositório fornece ferramentas para executar o benchmark. Resultados de modelos, revisão por especialistas e aprovação institucional não são presumidos. Adriano Coelho mantém o projeto. O Como Votam utiliza LLMs no produto; isso não altera o protocolo de avaliação.

Código sob Apache-2.0. Consulte a política de dados antes de redistribuir fontes ou itens derivados.

