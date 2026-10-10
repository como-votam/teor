---
license: other
language:
  - pt
task_categories:
  - question-answering
tags:
  - benchmark
  - legislative
  - brazil
---
# Dados do Teor

Itens em português derivados de fontes oficiais da Câmara dos Deputados e do Senado Federal. Os esquemas do Teor são próprios; não reproduzem schemas privados do Como Votam.

## Fontes e atribuição

- Câmara dos Deputados: [API de Dados Abertos](https://dadosabertos.camara.leg.br/swagger/api.html).
- Senado Federal: [API de Dados Abertos](https://legis.senado.leg.br/dadosabertos/api-docs/swagger-ui/index.html).
- Presidência da República: [Constituição Federal](https://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm), para regras constitucionais.

Cada item inclui URL e identificador da fonte. O manifesto registra arquivos, hashes, parâmetros e datas de obtenção. Setembro/2026 é a janela inicial; proposições anteriores podem aparecer se relacionadas a votações da janela.

## Reuso

O código é Apache-2.0. A proposta de licença dos itens derivados é CC-BY 4.0, condicionada aos termos de cada fonte. A existência de um portal de dados abertos não basta para atribuir uma licença específica aos documentos. Até confirmar os termos, esta card declara `license: other`; não afirma uma autorização formal ainda não documentada.

As páginas oficiais consultadas descrevem acesso público, mas não resolvem por si só todos os direitos sobre documentos associados. Registre a confirmação em `config/source-terms.json` antes de publicar o dataset. Assets da marca têm autorização específica para este projeto, não uma licença geral sobre a marca.

## Conteúdo e limitações

JSONL preserva o contrato completo; Parquet oferece colunas de busca e `item_json`. Perguntas públicas e gabaritos privados são arquivos diferentes. Splits Live só liberam gabaritos depois do fechamento.

Nomes e partidos de parlamentares podem constar em tarefas factuais; CPF, endereços e dados pessoais dispensáveis são excluídos das projeções. Respostas brutas ficam locais e não devem ser publicadas sem revisão.

Lacunas, documentos sem camada textual, fontes indisponíveis e ausência de comprovação temporal são registradas. O conjunto não representa automaticamente todas as atividades legislativas. Itens não são ouro antes de dupla revisão.

## Publicação

`teor export` prepara os arquivos para um único dataset no Hugging Face. Não cria conta, dataset remoto ou upload. Publicar requer revisar licenças, cobertura, gabaritos e atribuição.
