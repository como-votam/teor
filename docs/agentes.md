# Agentes de código (Claude Code, Codex, Cursor)

O Teor avalia um agente de código como um sistema: o agente recebe o prompt de cada item e devolve o JSON do protocolo. A pontuação, o parser tolerante e as regras de validade são as mesmas dos modelos. O que muda é a garantia de que o agente **não vê o gabarito, o código nem os dados privados**.

## Modelo de ameaça

Um agente de código lê arquivos e roda comandos. Se rodar na mesma máquina do repositório, pode abrir `published/items.jsonl`, `data/benchmark/` ou `private/` e copiar o gabarito. Por isso a execução é separada em três passos, e só o do meio toca no agente:

1. **Prepare (máquina confiável):** `teor agent prepare ITENS --output prompts.jsonl` grava só `item_id`, `variant`, `track`, `answer_type`, `prompt` e `prompt_format`. Não há gabarito nesse arquivo; `load_prompts` recusa qualquer outra chave.
2. **Run (agente isolado):** `teor agent run` lê só os prompts. Cada chamada é um processo novo, em um diretório temporário vazio, com ambiente reduzido (`PATH`, `HOME`, `LANG` e a credencial do próprio agente; nunca tokens do Teor, Cloudflare, Gemini ou GitHub).
3. **Score (máquina confiável):** `teor score ITENS previsoes.jsonl --config previsoes.config.json`, depois `teor submission validate`.

## Isolamento

| `--isolation` | O que garante | Publicável |
|---|---|---|
| `workdir` | Diretório vazio e ambiente reduzido. O agente ainda pode ler o disco inteiro. | Não (só smoke) |
| `sandbox-exec` | Como `workdir`, mais um perfil do macOS que nega a leitura do repositório e do diretório atual (e de `--deny-read`). O interpretador e o pacote `teor` continuam legíveis para o servidor MCP da trilha G. O hash do perfil vai no atestado. | Sim |
| `external` | Você declara que rodou em máquina, VM ou container sem o repositório. O comando recusa se achar `private/`, `published/` ou `data/benchmark/private/` nesta máquina. | Sim |

Em Linux ou CI use `external`: um runner que só tem o pacote `comovotam-teor` instalado e o `prompts.jsonl`, sem checkout do repositório. É também o único modo que sustenta um pedido de selo verificado.

Diretivas para quem opera:

- Use um usuário do sistema (ou VM) dedicado, sem `CLAUDE.md`, `AGENTS.md`, regras de Cursor, skills, MCPs ou memória pessoal no `HOME`. Instruções pessoais mudam o resultado e não aparecem no atestado.
- Autentique o agente por login ou chave própria. Não exporte outras chaves no shell.
- Não rode `teor agent run` dentro do diretório do repositório com `--isolation workdir`.
- Não aponte `TMPDIR` para dentro do repositório; o comando recusa.
- Informe a versão do agente: ela é gravada (`--version`) e entra no `run_id`. Aliases de modelo (`haiku`, `sonnet`) mudam com o tempo; o modelo resolvido é gravado em `agent_model_resolved`.

## Ferramentas

- Trilhas A–F: o Claude Code roda com `--tools ""` (nenhuma ferramenta nativa). O Codex roda com shell em diretório vazio e sandbox de leitura; o Cursor em modo `ask`. O perfil fica em `agent_tools` e só é comparável com o mesmo perfil.
- Trilha G: o único acesso a dados é o servidor MCP `teor` (`python -m teor.agent_mcp --api-url URL`), que expõe só `snapshot_record` sobre a API congelada (`teor serve`). Passe `--api-url`.
- Qualquer escrita no diretório de trabalho entra em `workdir_writes`; diferente de zero torna a submissão não publicável. `tool_calls` é registrado por previsão.
- A rede não é bloqueada: os agentes precisam dela para falar com o provedor. Um agente com navegação pode, em tese, buscar na web. Isso não é detectado; declare-o em `agent_tools` se o agente tiver essa ferramenta ativa.

## Passo a passo

```text
uv run teor agent prepare published/items.jsonl --output data/agent-prompts.jsonl
uv run teor agent run data/agent-prompts.jsonl claude haiku 5 --isolation sandbox-exec --output data/agent-claude.jsonl
uv run teor score published/items.jsonl data/agent-claude.jsonl --config data/agent-claude.config.json --output reports/agent-claude.json
uv run teor submission validate ...
```

`teor agent run` executa antes um preflight (um item por trilha e formato, variante 0) e aborta se mais de 15% sair do formato; `--preflight-only` roda só ele. Retoma de onde parou. Para em `budget` USD: o custo vem do próprio agente (Claude Code informa `total_cost_usd`); para agentes que só informam tokens passe `--prices` com `input_per_million` e `output_per_million`. Use `--max-calls` para um teto de chamadas e `--concurrency` baixo (cada chamada é um processo do agente).

`data/agent-claude.config.json` já traz `model_classification: "agent"`, agente, versão, modelo, perfil de ferramentas, isolamento e o atestado (chamadas, escritas, hash do perfil). Acrescente `snapshot`, `snapshot_state`, `price_as_of` e `provider`, como nas demais submissões. `teor submission validate` recusa submissão de agente sem esses campos, com `workdir`, sem atestado ou com escritas no diretório.

## Limites conhecidos

- A submissão continua **autodeclarada**; o selo verificado exige reprodução pelo mantenedor.
- O adaptador do Claude Code foi exercitado ao vivo. Os do Codex e do Cursor seguem a documentação das CLIs e têm testes de montagem de comando e leitura de saída, mas não foram executados de ponta a ponta (`adapter_verified_live: false` no atestado).
- A temperatura não é controlável; fica registrada como tal. Rodadas repetidas do mesmo agente podem divergir.
- `sandbox-exec` está obsoleto na Apple, mas ativo. Não substitui um ambiente sem o repositório.
