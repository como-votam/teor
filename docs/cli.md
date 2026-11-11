# CLI e reprodução

Todos os comandos assumem a raiz do repositório e o prefixo `uv run`. `teor COMMAND --help` lista opções e destinos. Nenhum comando executa commits.

## Dados

`collect` usa cache local por URL e parâmetros. Uma interrupção antes de selar o snapshot pode ser retomada no mesmo destino. Um manifesto selado não é sobrescrito: use outro destino para nova coleta. `snapshot verify` recalcula os hashes. `build` aceita snapshot incompleto para diagnóstico, mas marca o resultado como não publicável.

`build` grava itens públicos em `items.jsonl`, splits em arquivos próprios e gabaritos privados em `private/`. `export` recusa divisões ocultas e prepara JSONL, Parquet e dataset card para HF. `schemas` exporta contratos versionados.

## Avaliação

```text
teor run data/benchmark/test-lite.jsonl --model provider/model --prices config/prices.json --budget 10 --output data/previsoes.jsonl
teor score data/benchmark/test-lite.jsonl data/previsoes.jsonl --output reports/modelo.json
teor report reports/modelo.json
```

`teor run` começa por um **preflight**: um item de cada formato (trilha × tipo de resposta), três variantes cada, ~40 chamadas. Se mais de 15% das respostas vierem fora do formato (`--preflight-max-invalid`), o comando aborta mostrando exemplos brutos e não executa o run completo. `--preflight-only` roda só essa verificação; `--no-preflight` a desliga. Todo run grava também `SAIDA.raw.jsonl` com o texto bruto de cada resposta, para reavaliar sem repetir chamadas pagas.

Preços são valores por milhão de tokens e precisam de data. O limite de entrada é conservador: bytes UTF-8 limitam o pior caso de tokenização. A reserva usa esse teto, saída máxima e número de chamadas. Não configura limites de faturamento na conta do provedor.

`baseline` exige exemplos `dev` para classe majoritária e recuperação. Não usa respostas do teste para ajustar o baseline. `serve` abre somente a projeção pública do snapshot; `--cutoff` restringe dados anteriores ao corte.

## Site

`site export` aceita itens públicos, resultados compatíveis e previsões opcionais. Depois, em `site/`, execute `npm ci`, `npm run build` e `npm run preview`. O build sem exportação mostra estados vazios.

## Configuração remota

`github audit` lê apenas `como-votam/teor`. `github apply` aplica configurações idempotentes e salva relatório antes/depois. Falhas de disponibilidade e dependências do primeiro push aparecem como pendências, sem criação de conteúdo remoto.

## Agentes de código

`agent prepare` gera prompts sem gabarito; `agent run` executa Claude Code, Codex ou Cursor sobre eles com isolamento e atestado. Ver [agentes](agentes.md).
