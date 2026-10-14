---
license: cc-by-4.0
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

O código é Apache-2.0. Os itens derivados (perguntas, gabaritos e estrutura criados pelo Teor) são licenciados em CC-BY 4.0. O conteúdo originado das fontes oficiais segue os termos de cada casa legislativa, descritos abaixo. Atribuição obrigatória: "Câmara dos Deputados" e "Senado Federal", com a autoria quando houver.

## Termos das fontes (revisados em 2026-10-14)

- **Câmara dos Deputados:** [Termos gerais](https://www2.camara.leg.br/termo-de-uso-e-politica-de-privacidade/termos-gerais): "Todas as informações publicadas no Portal da Câmara são de domínio público, gratuitas e podem ser reproduzidas desde que citada a fonte 'Câmara dos Deputados' e a autoria da informação, quando houver." Não há licença formal específica para a API de dados abertos.
- **Senado Federal:** [Política de uso do portal](https://www12.senado.leg.br/institucional/documentos/politica-de-uso-do-portal-do-senado-federal): "Todo o conteúdo deste Portal é de propriedade autoral do Senado Federal, mas pode ser utilizado pelos usuários, desde que seja citada a fonte e para fins lícitos." Pelo [Sobre Dados Abertos](https://www12.senado.leg.br/dados-abertos/sobre), exige-se no máximo citar a proveniência. Não há licença formal específica.

Nenhuma das duas casas declara licença Creative Commons. Não afirmamos que as fontes são CC-BY.

## Conteúdo e limitações

JSONL preserva o contrato completo; Parquet oferece colunas de busca e `item_json`. Perguntas públicas e gabaritos privados são arquivos diferentes. Splits Live só liberam gabaritos depois do fechamento.

Nomes e partidos de parlamentares podem constar em tarefas factuais; CPF, endereços e dados pessoais dispensáveis são excluídos das projeções. Respostas brutas ficam locais e não devem ser publicadas sem revisão.

Lacunas, documentos sem camada textual, fontes indisponíveis e ausência de comprovação temporal são registradas. O conjunto não representa automaticamente todas as atividades legislativas. Itens não são ouro antes de dupla revisão.

## Publicação

`teor export` prepara os arquivos para um único dataset no Hugging Face. Não cria conta, dataset remoto ou upload. Publicar requer revisar licenças, cobertura, gabaritos e atribuição.
