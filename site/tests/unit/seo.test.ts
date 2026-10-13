import { describe, it, expect } from 'vitest';
import { createUrls, serializeJson, escapeXml, urls } from '../../src/lib/seo/config';
import {
  pages,
  markdownPath,
  publicResult,
  resultPath,
  overview,
} from '../../src/lib/seo/registry';
import { schemaGraph, resultDataset } from '../../src/lib/seo/schema';
import { pageBody, markdownDocument, llmsIndex } from '../../src/lib/seo/markdown';
import { data, type Result } from '../../src/data';

describe('endereços e publicação estática', () => {
  it('preserva a origem e o subdiretório em todos os artefatos', () => {
    const custom = createUrls('https://example.org', 'benchmark/');
    expect(custom.absolute('metodologia/')).toBe('https://example.org/benchmark/metodologia/');
    expect(custom.absolute('agent-markdown/index.md')).toBe(
      'https://example.org/benchmark/agent-markdown/index.md',
    );
    expect(custom.absolute('#benchmark')).toBe('https://example.org/benchmark/#benchmark');
    expect(custom.relative('/benchmark/trilhas/e/')).toBe('trilhas/e/');
    expect(custom.relative('/outro/')).toBeNull();
    expect(() => createUrls('https://example.org/path')).toThrow();
    expect(() => createUrls('https://user:secret@example.org')).toThrow();
    expect(() => createUrls('https://example.org', '../private')).toThrow();
  });
  it('serializa JSON-LD sem permitir que o conteúdo feche o script', () => {
    const payload = {
      value: '</script><script>bad()</script>',
      line: String.fromCharCode(0x2028),
      paragraph: String.fromCharCode(0x2029),
    };
    const serialized = serializeJson(payload);
    expect(serialized).not.toContain('<');
    expect(serialized).not.toContain(String.fromCharCode(0x2028));
    expect(serialized).not.toContain(String.fromCharCode(0x2029));
    expect(JSON.parse(serialized)).toEqual(payload);
    expect(escapeXml('https://example.org/?q=<a>&x="')).toBe(
      'https://example.org/?q=&lt;a&gt;&amp;x=&quot;',
    );
  });
});
describe('fatos, representações e proveniência', () => {
  it('toda página pública tem metadados únicos e uma representação completa', () => {
    expect(new Set(pages.map((p) => p.path)).size).toBe(pages.length);
    expect(new Set(pages.map((p) => p.title)).size).toBe(pages.length);
    expect(new Set(pages.map((p) => p.description)).size).toBe(pages.length);
    for (const p of pages) {
      expect(pageBody(p).length).toBeGreaterThan(100);
      expect(markdownDocument(p)).toContain(`canonical: ${JSON.stringify(urls.absolute(p.path))}`);
      expect(llmsIndex()).toContain(urls.absolute(markdownPath(p)));
    }
  });
  it('HTML/Markdown e Dataset usam os mesmos totais e distinguem baselines de LLMs', () => {
    const graph = schemaGraph(pages[0])['@graph'];
    const summary = graph.find((n) => n['@id'] === urls.absolute('#estado-publicacao'))!;
    expect(summary.variableMeasured).toEqual(
      overview.facts.map((f) => ({
        '@type': 'PropertyValue',
        name: f.label,
        value: f.value,
        unitText: f.unit,
      })),
    );
    expect(overview.facts.find((f) => f.label === 'Baselines publicados')!.value).toBe(
      new Set(data.results.filter((r) => r.model.startsWith('baseline/')).map((r) => r.model)).size,
    );
    expect(pageBody(pages[0])).toContain(
      'Baselines determinísticos não são avaliações de modelos de linguagem.',
    );
  });
  it('publica somente a projeção de métricas e não redistribui configuração bruta', () => {
    const result: Result = {
      id: 'fixture-run',
      model: 'baseline/fixture',
      dataset_hash: 'fixture-dataset',
      protocol_hash: 'fixture-protocol',
      verification: 'autodeclarado',
      complete: true,
      created_at: '2026-01-01T00:00:00Z',
      metrics: [
        {
          track: 'A',
          task: 'type',
          chamber: 'camara',
          mode: 'with_context',
          split: 'test-public',
          score: { mean: 0.25, ci95: [0.1, 0.4], n: 4, families: 2 },
        },
      ],
      usage: { coverage: 1, cost_usd: null, latency_mean_seconds: null },
      config: { provider_token: 'do-not-export' },
    };
    expect(JSON.stringify(publicResult(result))).not.toContain('do-not-export');
    const dataset = resultDataset(result);
    expect(dataset.identifier).toContainEqual({
      '@type': 'PropertyValue',
      propertyID: 'dataset_hash',
      value: result.dataset_hash,
    });
    expect(dataset.identifier).toContainEqual({
      '@type': 'PropertyValue',
      propertyID: 'protocol_hash',
      value: result.protocol_hash,
    });
    expect(dataset.distribution).toMatchObject({ contentUrl: urls.absolute(resultPath(result)) });
    expect(dataset.dateCreated).toBe(result.created_at);
    expect(JSON.stringify(dataset)).not.toMatch(/AggregateRating|overallScore|CC-BY-4\.0/);
  });
  it('não anuncia partições ou um conjunto publicado quando a exportação está ausente', () => {
    const graph = schemaGraph(pages.find((p) => p.path === 'dados/')!)['@graph'];
    if (!data.count) expect(graph.some((n) => n['@type'] === 'Dataset')).toBe(false);
  });
  it('o FAQ estruturado corresponde às perguntas que o site apresenta', () => {
    const faq = schemaGraph(pages[0])['@graph'].find((n) => n['@type'] === 'FAQPage')!;
    const questions = faq.mainEntity as Array<{ name: string; acceptedAnswer: { text: string } }>;
    for (const q of questions) {
      expect(pageBody(pages[0])).toContain(q.name);
      expect(pageBody(pages[0])).toContain(q.acceptedAnswer.text);
    }
    expect(questions).toHaveLength(6);
  });
});
