import { taskNames, modeNames, chamberNames, modelName } from '../data/labels';
const tracks = JSON.parse(document.getElementById('track-data')!.textContent!) as string[][];
document.querySelectorAll<HTMLButtonElement>('[data-map-track]').forEach((button) =>
  button.addEventListener('click', () => {
    const id = button.dataset.mapTrack!;
    const track = tracks.find((t) => t[0] === id)!;
    document
      .querySelectorAll('[data-map-track]')
      .forEach((el) => el.setAttribute('aria-pressed', String(el === button)));
    document
      .querySelectorAll<SVGGElement>('[data-sector]')
      .forEach((el) => el.classList.toggle('selected', el.dataset.sector === id));
    document.getElementById('map-title')!.textContent = `${track[0]} · ${track[1]}`;
    document.getElementById('map-copy')!.textContent = track[2];
    (document.getElementById('map-link') as HTMLAnchorElement).href = `#trilha-${id}`;
    document.querySelectorAll<HTMLElement>('.track').forEach((el) => {
      el.hidden = false;
    });
    document
      .querySelectorAll('[data-track-group]')
      .forEach((el) =>
        el.setAttribute('aria-pressed', String(el.getAttribute('data-track-group') === 'all')),
      );
  }),
);
document.querySelectorAll<HTMLButtonElement>('[data-track-group]').forEach((button) =>
  button.addEventListener('click', () => {
    document
      .querySelectorAll('[data-track-group]')
      .forEach((el) => el.setAttribute('aria-pressed', String(el === button)));
    document.querySelectorAll<HTMLElement>('[data-track-category]').forEach((el) => {
      el.hidden =
        button.dataset.trackGroup !== 'all' &&
        button.dataset.trackGroup !== el.dataset.trackCategory;
    });
  }),
);
const table = document.getElementById('leaderboard') as HTMLTableElement | null;
if (table) {
  const ids = [
    'track',
    'task',
    'chamber',
    'mode',
    'weights',
    'since',
    'cohort',
    'split',
    'temporal',
  ];
  const inputs = Object.fromEntries(
    ids.map((id) => [id, document.getElementById(id) as HTMLInputElement | HTMLSelectElement]),
  );
  const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>('tbody tr'));
  const params = new URLSearchParams(location.search);
  ids.forEach((id) => {
    const value = params.get(id);
    if (
      value !== null &&
      (inputs[id] instanceof HTMLInputElement ||
        Array.from((inputs[id] as HTMLSelectElement).options).some((o) => o.value === value))
    )
      inputs[id].value = value;
  });
  let descending = true;
  let view = params.get('view') === 'chart' ? 'chart' : 'table';
  function renderChart(visible: HTMLTableRowElement[]) {
    const chart = document.getElementById('score-chart')!;
    chart.replaceChildren();
    for (const row of visible) {
      const d = row.dataset;
      const item = document.createElement('div');
      item.className = 'chart-row';
      const label = document.createElement('a');
      label.href = row.querySelector('a')!.href;
      label.className = 'chart-label';
      const model = document.createElement('strong');
      model.textContent = modelName(d.model!);
      const detail = document.createElement('small');
      detail.textContent = `${d.track} · ${taskNames[d.task!] || d.task} · ${chamberNames[d.chamber!] || d.chamber} · ${modeNames[d.mode!] || d.mode} · ${d.split}`;
      label.append(model, detail);
      const plot = document.createElement('div');
      plot.className = 'interval-plot';
      const line = document.createElement('span');
      line.className = 'interval-line';
      line.style.left = `${Number(d.low) * 100}%`;
      line.style.width = `${(Number(d.high) - Number(d.low)) * 100}%`;
      const point = document.createElement('span');
      point.className = 'interval-point';
      point.style.left = `${Number(d.score) * 100}%`;
      const value = document.createElement('span');
      value.className = 'chart-value';
      value.textContent = row.cells[3].querySelector('strong')!.textContent;
      const range = `${(Number(d.low) * 100).toFixed(1)} a ${(Number(d.high) * 100).toFixed(1)}%`;
      plot.setAttribute('role', 'img');
      plot.setAttribute('aria-label', `Nota ${value.textContent}, intervalo de confiança ${range}`);
      plot.title = `IC 95%: ${range}`;
      plot.append(line, point);
      item.append(label, plot, value);
      chart.append(item);
    }
  }
  function syncURL() {
    const next = new URL(location.href);
    ids.forEach((id) => next.searchParams.set(id, inputs[id].value));
    next.searchParams.set('view', view);
    history.replaceState(null, '', next);
  }
  function filter(updateURL = true) {
    let visible: HTMLTableRowElement[] = [];
    rows.forEach((row) => {
      const d = row.dataset;
      const show =
        ['track', 'task', 'chamber', 'mode', 'cohort', 'split', 'temporal'].every(
          (id) => !inputs[id].value || inputs[id].value === (d[id] || ''),
        ) &&
        (!inputs.since.value || String(d.date) >= inputs.since.value) &&
        (!inputs.weights.value ||
          (inputs.weights.value === 'open' && d.open === 'true') ||
          (inputs.weights.value === 'closed' && d.open === 'false') ||
          (inputs.weights.value === 'brazilian' && d.brazilian === 'true'));
      row.hidden = !show;
      if (show) visible.push(row);
    });
    visible.sort(
      (a, b) => (Number(b.dataset.score) - Number(a.dataset.score)) * (descending ? 1 : -1),
    );
    visible.forEach((row) => table!.tBodies[0].append(row));
    document.getElementById('filter-status')!.textContent =
      `${visible.length} ${visible.length === 1 ? 'resultado exibido' : 'resultados exibidos'}`;
    document.getElementById('filter-empty')!.hidden = visible.length > 0;
    const strata = new Set(
      visible.map((r) =>
        ['track', 'task', 'chamber', 'mode', 'cohort', 'split', 'temporal']
          .map((id) => r.dataset[id] || '')
          .join('|'),
      ),
    );
    document.getElementById('comparison-warning')!.hidden = strata.size <= 1;
    document
      .querySelectorAll<HTMLButtonElement>('[data-view]')
      .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
    document.getElementById('table-view')!.hidden = view !== 'table' || !visible.length;
    document.getElementById('chart-view')!.hidden = view !== 'chart' || !visible.length;
    (document.getElementById('export-results') as HTMLButtonElement).disabled = !visible.length;
    renderChart(visible);
    if (updateURL) syncURL();
  }
  function reset() {
    ids.forEach((id) => {
      if (id !== 'cohort') inputs[id].value = '';
    });
    filter();
  }
  ids.forEach((id) =>
    inputs[id].addEventListener('change', () => {
      if (
        id === 'track' &&
        inputs.task.value &&
        !rows.some(
          (r) =>
            (!inputs.track.value || r.dataset.track === inputs.track.value) &&
            r.dataset.task === inputs.task.value,
        )
      )
        inputs.task.value = '';
      filter();
    }),
  );
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) =>
    b.addEventListener('click', () => {
      view = b.dataset.view!;
      filter();
    }),
  );
  document.getElementById('reset-filters')!.addEventListener('click', reset);
  document.getElementById('empty-reset')!.addEventListener('click', reset);
  document.getElementById('sort-score')!.addEventListener('click', () => {
    descending = !descending;
    table
      .querySelectorAll('th')[3]
      .setAttribute('aria-sort', descending ? 'descending' : 'ascending');
    document.getElementById('sort-indicator')!.textContent = descending ? '↓' : '↑';
    filter();
  });
  document.getElementById('export-results')!.addEventListener('click', () => {
    // Escape spreadsheet formula prefixes as well as CSV delimiters.
    const cell = (value: string) =>
      `"${(/^[=+@-]/.test(value) ? "'" + value : value).replaceAll('"', '""')}"`;
    const headings = [
      'modelo',
      'trilha',
      'tarefa',
      'casa',
      'modo',
      'divisao',
      'qualidade_temporal',
      'dataset_e_protocolo',
      'data',
      'nota',
      'ic95_min',
      'ic95_max',
      'cobertura',
      'verificacao',
    ];
    const csv = [
      headings,
      ...Array.from(table.querySelectorAll<HTMLTableRowElement>('tbody tr'))
        .filter((r) => !r.hidden)
        .map((r) => [
          r.dataset.model!,
          ...[
            'track',
            'task',
            'chamber',
            'mode',
            'split',
            'temporal',
            'cohort',
            'date',
            'score',
            'low',
            'high',
          ].map((k) => r.dataset[k] || ''),
          r.cells[4].querySelector('strong')!.textContent!,
          r.cells[5].textContent!.trim(),
        ]),
    ]
      .map((row) => row.map(cell).join(','))
      .join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'teor-resultados.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  filter(false);
}
