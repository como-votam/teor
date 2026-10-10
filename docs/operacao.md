# Curadoria, rodadas e submissões

`teor review promote itens.jsonl revisoes.jsonl --output private/ouro-v1` cria um lote ouro somente com itens aprovados por duas revisões independentes ou adjudicação válida. Os julgamentos carregam o hash do item: corrigir um gabarito invalida a aprovação antiga. Rodadas ocultas só aceitam entradas privadas, nunca perguntas já presentes em dev ou teste público.

Para integrar fidelidade humana ao resultado de F, use `teor score itens.jsonl previsoes.jsonl --reviews revisoes.jsonl --output reports/com-revisao.json`. O cálculo exige dois julgamentos por afirmação, adjudicação em caso de divergência e hash compatível. A cobertura das revisões acompanha a métrica; julgamentos incertos ficam pendentes. Submissões com essa métrica incluem as revisões e são recalculadas com `--reviews`, sem transformar presença de citações em suporte semântico.

Rodadas ficam em diretório privado do mantenedor. `round create` congela itens e hash. Datas precisam incluir fuso. `round export` libera somente perguntas durante a janela aberta. `round close` exige prazo encerrado. `round publish` exige rodada fechada e gabarito com o hash original.

Pontue previsões localmente com `score`, usando o gabarito privado. Submissões públicas só entram depois da publicação da rodada. Não há pontuador hospedado nem coleta de chaves pelo site.

`review export` cria o lote local. `review import` recusa identidades duplicadas; revisões corrigidas exigem nova versão. `review adjudicate` exige dois julgamentos independentes e um adjudicador diferente. O relatório informa concordância, Cohen kappa quando definido, decisões e elegibilidade para ouro.

Resultados autodeclarados podem entrar após validação estrutural e recálculo. Mudar o selo para verificado exige registrar mantenedor e evidência; um contribuidor não pode se autoatribuir o selo pela validação de arquivos.

Erratas devem identificar versões afetadas. Nunca reescreva snapshot ou resultado histórico para esconder uma correção.
