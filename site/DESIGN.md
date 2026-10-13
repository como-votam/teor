# Teor: identidade e interface

O site adapta a identidade do frontend público do Como Votam para Astro. Newsreader nos títulos, Public Sans na interface e Space Mono nos identificadores e dados. Essa escolha segue o pedido explícito de reutilização da marca.

## Origem dos elementos

- `src/styles/tokens.css`: cores, superfícies, raios e curva de movimento de `comovotam-frontend/src/app/(public)/globals.css`.
- `public/brand.svg`: paths de `shared/components/navigation/logo-mark-paths.ts`.
- `public/favicon.svg`: `comovotam-frontend/src/app/icon.svg`.
- `public/og.png`: imagem de compartilhamento do Como Votam. Identifica a marca mãe; não é uma captura do benchmark.
- Botões, badges, linhas, disclosure e barras adaptam os padrões públicos à renderização estática.
- Mapa das trilhas: linguagem de pontos do hemiciclo; os setores identificam capacidades, nunca votos ou quantidades de itens.
- Gráficos de notas: barras neutras/verde e intervalos explícitos, inspirados nos componentes de governismo. Nenhuma agregação entre tarefas.

## Dados e comparação

A exportação em `src/data/generated.json` continua sendo a fonte principal. Na ausência dela, o site lê somente `../results/baseline-*.json`, relatórios já publicados no repositório. Nenhum item privado é lido. Quiz, explorador e rodadas têm estados vazios quando seus artefatos não existem.

O recorte inicial seleciona uma tarefa, casa, modo, divisão, qualidade temporal e coorte comparáveis. Filtros ampliados mostram aviso quando há estratos diferentes. Cada ponto representa a métrica original, com seu IC 95%; não há uma nota geral. Filtros e modo de visualização podem ser compartilhados pela URL. CSV exporta apenas as linhas visíveis com a proveniência.

## Interações

- Mapa com oito seletores acessíveis e links para cada trilha.
- Tabela e gráfico, ordenação de notas, filtros adicionais, reset e CSV.
- Trilhas agrupáveis e explicações com disclosure nativo.
- Navegação móvel com estado anunciado, foco visível e fechamento por Escape.
- Busca local no explorador, skeleton durante a carga e mensagens de erro/ausência.
- Quiz com progresso, validação de resposta, Enter, fontes após a resposta e reinício.
- Sem persistência das respostas do quiz. Movimento reduzido respeitado.

Skills aplicadas: landing-page-design e interface-details (design, tipografia, interatividade, acessibilidade, movimento e microcopy). A identidade e os padrões existentes do Como Votam prevalecem sobre sugestões genéricas de tipografia e navegação.
