# Erratas

Nenhuma errata publicada nesta versão inicial. Correções futuras precisam identificar item, motivo, fonte e versão afetada.

Snapshots são imutáveis. Corrigir um gabarito gera nova versão do dataset e novo hash; resultados antigos continuam disponíveis com o protocolo original. Recalcular uma nota não deve sobrescrever a execução publicada.

Para reportar um problema, abra uma issue pública com o identificador do item e a fonte oficial. Não inclua gabaritos de rodadas ainda abertas.

O mantenedor prepara um JSONL de correções com `item_id`, `old_item_hash`, `reason`, `url` e `answer` no contrato de resposta. `teor errata itens.jsonl correcoes.jsonl nova-versao` verifica a versão afetada, cria os itens e o manifesto de correções em outro diretório e exige nova revisão dos itens alterados. Correções de pares H precisam abranger todos os membros para preservar a invariância do gabarito. Execute novamente `teor score` com destino distinto para cada resultado recalculado.
