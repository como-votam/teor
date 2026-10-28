# Provedores e batch

Execução síncrona usa Inspect AI. Instale `eval` e o SDK do provedor por extras. Modelos locais podem ser servidos por vLLM em outra máquina; o Teor não precisa de GPU no Windows. Consulte [Inspect](https://inspect.aisi.org.uk/providers.html) para nomes e credenciais.

## Configuração de lote

Um lote precisa de provedor, modelo, preços, orçamento e capacidades verificadas com data. Para cloud, informe a região tanto nos recursos quanto nas capacidades. Não existe fallback automático para execução síncrona.

```json
{
  "region": "REGIAO",
  "capabilities": {"model": "MODELO", "region": "REGIAO", "batch": true, "as_of": "AAAA-MM-DD"}
}
```

| Provedor | Extra | Recursos/configuração |
|---|---|---|
| OpenAI | openai | OPENAI_API_KEY |
| Anthropic | anthropic | ANTHROPIC_API_KEY |
| Gemini | google | GEMINI_API_KEY; family=gemini |
| Vertex | vertex | project, region, bucket, prefix; family=gemini ou claude; ADC |
| Bedrock | bedrock | region, bucket, prefix, role_arn; credenciais AWS |
| Azure | azure | region, endpoint, modelo como nome do deployment batch; chave ou identidade Azure |

Vertex também aceita `bigquery_input` e `bigquery_output`. A tabela de entrada deve corresponder aos requests preparados; recursos não são provisionados pela ferramenta.

```text
teor batch prepare itens.jsonl --provider vertex --model MODELO --config config/cloud.json --prices config/prices.json --budget 10
teor batch submit data/batch
teor batch status data/batch
teor batch import data/batch --output data/previsoes.jsonl
teor batch cancel data/batch
```

Submissão salva estado antes de enviar. Uma interrupção entre envio e gravação do ID remoto exige reconciliação manual do `remote_id`; não reenviamos um job possivelmente cobrado. Resultados fora de ordem são associados por ID ou hash do request, nunca por posição.

G usa interação síncrona. APIs batch não substituem o ciclo de chamadas a ferramentas. Erros parciais ficam explícitos no arquivo de previsões. Custos desconhecidos permanecem nulos.

Para calibrar com modelos pequenos e de fronteira, copie `config/calibration.example.json`, informe modelos, endpoints e orçamentos reais e execute `teor calibration run itens.jsonl configuracao.json precos.json`. O comando salva previsões e resultados por modelo com retomada pelo Inspect. `teor calibration report itens.jsonl previsoes-pequeno.jsonl previsoes-fronteira.jsonl --output nova-calibracao` gera uma versão com dificuldade empírica, preservando gabaritos. F continua pendente de julgamento humano. Esses comandos enviam chamadas somente quando acionados pelo operador; os exemplos não executam modelos.

Documentação de referência: [Gemini](https://ai.google.dev/gemini-api/docs/batch-api), [Vertex](https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/claude/batch), [Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/batch-inference-create.html), [Azure](https://learn.microsoft.com/azure/foundry/openai/how-to/batch).

## Saída estruturada e Cloudflare Workers AI

No arquivo de preços, `"structured_output": true` faz o `teor run` enviar um esquema JSON (`value` livre, `abstain` booleano, sem outras chaves) nas trilhas sem ferramentas. Foi verificado no `@cf/ibm-granite/granite-4.0-h-micro`; em outros modelos, confirme antes com `--preflight-only`. O nome do modelo no Inspect é `cloudflare/@cf/...`, com `CLOUDFLARE_ACCOUNT_ID` e `CLOUDFLARE_API_TOKEN` no ambiente. Neurons = tokens × taxa por milhão (`neurons_per_million` em `config/prices-cloudflare.json`); a franquia gratuita é de 10.000 por dia (UTC) e o excedente é cobrado, não bloqueado.
