# Como contribuir

Uma contribuição pode corrigir um gabarito, ampliar a cobertura de uma fonte, melhorar um teste ou submeter uma avaliação. Comece pela evidência concreta: item, resposta oficial, endpoint ou comportamento observado.

## Submeter resultados

Execute os três prompts de cada item no mesmo protocolo. Guarde previsões, configuração, identificação do modelo e consumo. Use `teor score` e `teor submission validate` antes de abrir um PR em `results/`.

Submissões de terceiros são autodeclaradas. O selo verificado depende de reprodução pelo mantenedor ou execução supervisionada. Não publique respostas de uma rodada oculta antes do fechamento e da divulgação do gabarito.

Arquivos grandes devem permanecer fora do Git, com referência e hash no pacote de submissão. Tokens, endpoints internos e dados privados não pertencem a uma contribuição pública.

## Trabalhar no código

Instale as dependências com os lockfiles. Rode os testes offline antes de propor alterações. Comente a razão de uma decisão quando ela afetar temporalidade, segurança, métricas ou compatibilidade com a fonte. Não é necessário repetir em português o que uma expressão Python já diz.

Não reutilize implementação, schemas, prompts ou infraestrutura de repositórios privados. Marca e logo têm autorização separada para o site.

[Abrir uma issue](https://github.com/como-votam/teor/issues/new/choose) · [Ler o protocolo](https://github.com/como-votam/teor/blob/main/docs/metodologia.md)
