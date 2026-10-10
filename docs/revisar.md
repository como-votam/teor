# Revisar itens

A revisão verifica se o contexto permite a pergunta e se o gabarito está sustentado pela fonte. O lote de revisão é exportado pela CLI e aberto localmente; não há serviço que receba julgamentos pelo site.

```text
teor review export data/benchmark/test-public.jsonl --output private/review
teor review import revisoes-do-revisor.jsonl
teor review report private/reviews.jsonl
```

Abra `private/review/index.html` e selecione `review-batch.json`. Identifique o revisor, indique sustentado, não sustentado ou incerto e explique a evidência. Exporte o arquivo antes de fechar a aba.

Dois revisores trabalham de forma independente. Um não deve receber o julgamento do outro. Divergências são adjudicadas por um terceiro responsável; só depois o item pode receber selo ouro.

Na trilha F, exporte também as previsões. Cada afirmação terá uma tarefa de revisão. Localizar um trecho não basta: avalie se ele sustenta a afirmação inteira.
