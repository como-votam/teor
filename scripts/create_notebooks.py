"""Células curtas mantêm as análises executáveis sem fingir achados de modelos não avaliados."""

from pathlib import Path

import nbformat

setup = """from pathlib import Path
import json
from collections import Counter, defaultdict
from teor.build import load_items
from teor.io import read_json, read_jsonl
from teor.models import Result
root = Path.cwd()
if not (root / 'pyproject.toml').exists():
    root = root.parent
benchmark = root / 'data/benchmark'
items = load_items(benchmark / 'test-public.jsonl') if (benchmark / 'test-public.jsonl').exists() else []
results = [Result.model_validate(read_json(p)) for p in sorted((root / 'results').glob('*.json'))]
print(f'{len(items)} itens públicos; {len(results)} resultados publicados')
"""
analyses = {
    "01-coleta": (
        "Cobertura e lacunas da coleta",
        "Não confundir endpoints consultados com cobertura completa. Um manifesto incompleto permanece visível.",
        """manifests = sorted((root / 'data').glob('setembro-2026*/manifest.json'))
for path in manifests:
    manifest = read_json(path)
    print(path.parent.name, manifest['state'], manifest['coverage'])
    print('Lacunas:', len(manifest['gaps']))
if not manifests:
    print('Nenhuma coleta local. Execute teor collect para esta análise.')
""",
    ),
    "02-cobertura": (
        "Distribuição dos itens",
        "A ausência de uma trilha ou casa deve aparecer no relatório, não ser ocultada pelo número total.",
        """for field in ('track', 'chamber', 'mode', 'task'):
    print(field, dict(Counter(getattr(item, field) for item in items)))
print('Famílias independentes:', len({item.family for item in items}))
print('Candidatos a ouro não são itens revisados.')
""",
    ),
    "03-metricas": (
        "Notas e incerteza",
        "Intervalos usam famílias; não somamos trilhas diferentes em um ranking único.",
        """for result in results:
    print(result.model, result.verification, result.usage)
    for metric in result.metrics:
        if metric.get('score'):
            print(metric['track'], metric['task'], metric['score'])
if not results:
    print('Nenhuma avaliação publicada; sem conclusão sobre modelos.')
""",
    ),
    "04-prompts": (
        "Sensibilidade ao enunciado",
        "Variantes do mesmo fato devem compartilhar o grupo estatístico. A variância entre prompts não substitui o IC.",
        """for result in results:
    for metric in result.metrics:
        if 'prompt_sensitivity' in metric:
            print(result.model, metric['track'], metric['task'], metric['prompt_sensitivity'])
if not results:
    print('Aguardando previsões para os três enunciados.')
""",
    ),
    "05-previsao": (
        "Previsão e baselines",
        "Dados coletados depois da votação são retrospectivos. Só comparações com o mesmo conjunto e corte são válidas.",
        """print('Qualidade temporal:', dict(Counter(item.temporal_quality for item in items if item.track == 'E')))
for result in results:
    for metric in result.metrics:
        if metric['track'] == 'E':
            print(result.model, metric['task'], metric.get('brier'), metric.get('brier_gain'))
print('Orientações sem disponibilidade anterior comprovada não são baselines elegíveis.')
""",
    ),
    "06-paridade": (
        "Diferenças pareadas",
        "Cenários contrafactuais preservam o gabarito. Uma diferença observada não prova viés causal.",
        """print('Pares:', len({item.pair_id for item in items if item.pair_id}))
for result in results:
    for metric in result.metrics:
        if metric['track'] == 'H' and metric['task'] == 'paired_gap':
            print(result.model, metric)
if not results:
    print('Aguardando avaliações; nenhuma afirmação sobre paridade.')
""",
    ),
}
Path("analyses").mkdir(exist_ok=True)
for name, (title, reason, code) in analyses.items():
    notebook = nbformat.v4.new_notebook(
        cells=[
            nbformat.v4.new_markdown_cell(f"# {title}\n\n{reason}"),
            nbformat.v4.new_code_cell(setup),
            nbformat.v4.new_code_cell(code),
        ],
        metadata={
            "kernelspec": {"name": "python3", "display_name": "Python (Teor)", "language": "python"}
        },
    )
    nbformat.write(notebook, Path("analyses") / f"{name}.ipynb")
