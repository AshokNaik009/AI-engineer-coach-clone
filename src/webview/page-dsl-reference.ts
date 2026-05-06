/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* DSL Reference: field, function, metric reference + parser coverage matrix.
   Rendered inside a modal in the Anti-Patterns / Rules page. */

import { ParserCoverageData, ParserPreviewData } from '../core/types';
import { rpc } from './shared';
import { html, render } from './render';

interface DslField {
  name: string;
  type: string;
  scope: string;
  description: string;
}

interface DslFunction {
  name: string;
  signature: string;
  description: string;
  category: string;
}

interface DslMetric {
  id: string;
  name: string;
  scope: string;
  filterExpr: string;
}

/** Renders DSL Reference content into the given container (async — fetches schema data). */
export async function renderDslReferenceContent(container: HTMLElement): Promise<void> {
  const [schemaResult, funcResult, metricResult] = await Promise.allSettled([
    rpc<{ fields: DslField[] }>('getFieldSchema', undefined),
    rpc<{ functions: DslFunction[] }>('getFunctionCatalog', undefined),
    rpc<{ metrics: DslMetric[] }>('getMetricList', undefined),
  ]);

  const fields = schemaResult.status === 'fulfilled' ? (schemaResult.value.fields ?? []) : [];
  const functions = funcResult.status === 'fulfilled' ? (funcResult.value.functions ?? []) : [];
  const metrics = metricResult.status === 'fulfilled' ? (metricResult.value.metrics ?? []) : [];

  const functionGroups = groupFunctions(functions);

  render(html`
    <p class="dsl-ref-intro">This reference lists every field, function, and metric available in the rule DSL. Use it while writing or editing rules to look up field names, check function signatures, browse built-in metrics, and verify which fields each log parser supports.</p>

    <div class="dsl-ref-tabs">
      <button class="dsl-tab active" data-tab="fields">Fields</button>
      <button class="dsl-tab" data-tab="functions">Functions</button>
      <button class="dsl-tab" data-tab="metrics">Metrics</button>
      <button class="dsl-tab" data-tab="parser-coverage">Parser Coverage</button>
    </div>

    <div class="dsl-ref-pane" id="dsl-fields">
      <input type="text" class="ref-search" id="dsl-field-search" placeholder="Search fields..." />
      <table class="dsl-table">
        <thead><tr><th>Name</th><th>Type</th><th>Scope</th><th>Description</th></tr></thead>
        <tbody>
          ${fields.map(f => html`
            <tr class="dsl-field-row">
              <td><code>${f.name}</code></td>
              <td><span class="dsl-type">${f.type}</span></td>
              <td><span class="ref-scope">${f.scope}</span></td>
              <td>${f.description}</td>
            </tr>
          `)}
        </tbody>
      </table>
    </div>

    <div class="dsl-ref-pane" id="dsl-functions" style="display:none">
      ${functionGroups.map(([cat, fns]) => html`
        <h4 class="dsl-fn-group">${cat}</h4>
        <table class="dsl-table"><thead><tr><th>Signature</th><th>Description</th></tr></thead><tbody>
          ${fns.map(f => html`<tr><td><code>${f.signature}</code></td><td>${f.description}</td></tr>`)}
        </tbody></table>
      `)}
    </div>

    <div class="dsl-ref-pane" id="dsl-metrics" style="display:none">
      <table class="dsl-table">
        <thead><tr><th>ID</th><th>Name</th><th>Scope</th><th>Filter Expression</th></tr></thead>
        <tbody>
          ${metrics.map(m => html`
            <tr>
              <td><code>${m.id}</code></td>
              <td>${m.name}</td>
              <td><span class="ref-scope">${m.scope}</span></td>
              <td><code class="dsl-expr">${m.filterExpr}</code></td>
            </tr>
          `)}
        </tbody>
      </table>
    </div>

    <div class="dsl-ref-pane" id="dsl-parser-coverage" style="display:none">
      <div class="coverage-loading">Loading parser coverage\u2026</div>
    </div>
  `, container);

  wireDslReferenceContent(container);
}

/** Wires tab switching, field search, and lazy parser coverage load. */
function wireDslReferenceContent(root: HTMLElement): void {
  let coverageLoaded = false;

  for (const tab of root.querySelectorAll('.dsl-tab')) {
    tab.addEventListener('click', () => {
      for (const t of root.querySelectorAll('.dsl-tab')) t.classList.remove('active');
      tab.classList.add('active');
      const tabName = (tab as HTMLElement).dataset.tab;
      for (const p of root.querySelectorAll('.dsl-ref-pane')) {
        (p as HTMLElement).style.display = p.id === `dsl-${tabName}` ? '' : 'none';
      }
      if (tabName === 'parser-coverage' && !coverageLoaded) {
        coverageLoaded = true;
        void loadParserCoverage(root);
      }
    });
  }

  const fieldSearch = root.querySelector('#dsl-field-search') as HTMLInputElement;
  if (fieldSearch) {
    fieldSearch.addEventListener('input', () => {
      const query = fieldSearch.value.toLowerCase();
      for (const el of root.querySelectorAll('#dsl-fields .dsl-field-row')) {
        const text = el.textContent?.toLowerCase() || '';
        (el as HTMLElement).style.display = text.includes(query) ? '' : 'none';
      }
    });
  }
}

function groupFunctions(functions: Array<{ name: string; signature: string; description: string; category: string }>): [string, typeof functions][] {
  const groups = new Map<string, typeof functions>();
  for (const f of functions) {
    const cat = f.category || 'utility';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(f);
  }
  return [...groups.entries()];
}

async function loadParserCoverage(root: HTMLElement): Promise<void> {
  const pane = root.querySelector('#dsl-parser-coverage') as HTMLElement;
  if (!pane) return;
  render(html`<div class="loading-spinner"></div>`, pane);

  let coverageData: ParserCoverageData;
  let previewData: ParserPreviewData | null = null;
  try {
    coverageData = await rpc<ParserCoverageData>('getParserCoverage');
  } catch {
    render(html`<p class="muted">Failed to load parser coverage data.</p>`, pane);
    return;
  }

  if (coverageData.harnesses.length === 0) {
    render(html`<p class="muted">No harness data found.</p>`, pane);
    return;
  }

  render(html`
    <div class="coverage-view-toggle">
      <button class="coverage-toggle-btn active" data-view="matrix">Matrix</button>
      <button class="coverage-toggle-btn" data-view="preview">Preview</button>
    </div>
    <div id="coverage-matrix-view"></div>
    <div id="coverage-preview-view" style="display:none"></div>
  `, pane);

  renderMatrixView(pane.querySelector('#coverage-matrix-view')!, coverageData);

  const previewEl = pane.querySelector('#coverage-preview-view') as HTMLElement;

  const onFieldClick = (fieldName: string): void => {
    void (async () => {
      render(html`<div class="loading-spinner"></div>`, previewEl);
      try {
        previewData = await rpc<ParserPreviewData>('getParserPreview', { focusField: fieldName });
        renderPreviewView(previewEl, previewData, fieldName, onFieldClick);
      } catch {
        render(html`<p class="muted">Failed to load preview data.</p>`, previewEl);
      }
    })();
  };

  for (const btn of pane.querySelectorAll<HTMLElement>('.coverage-toggle-btn')) {
    btn.addEventListener('click', () => {
      void (async () => {
        for (const b of pane.querySelectorAll<HTMLElement>('.coverage-toggle-btn')) b.classList.remove('active');
        btn.classList.add('active');
        const view = btn.dataset.view;
        const matrixEl = pane.querySelector<HTMLElement>('#coverage-matrix-view');
        if (!matrixEl) return;
        matrixEl.style.display = view === 'matrix' ? '' : 'none';
        previewEl.style.display = view === 'preview' ? '' : 'none';

        if (view === 'preview' && !previewData) {
          render(html`<div class="loading-spinner"></div>`, previewEl);
          try {
            previewData = await rpc<ParserPreviewData>('getParserPreview');
            renderPreviewView(previewEl, previewData, undefined, onFieldClick);
          } catch {
            render(html`<p class="muted">Failed to load preview data.</p>`, previewEl);
          }
        }
      })();
    });
  }
}

function renderMatrixView(container: HTMLElement, data: ParserCoverageData): void {
  const catLabels: Record<string, string> = {
    'core': 'Core',
    'enrichment': 'Enrichment',
    'auto-computed': 'Auto-computed',
  };

  let prevCat = '';
  const rows: Array<{ type: 'cat'; label: string } | { type: 'field'; field: ParserCoverageData['fields'][0] }> = [];
  for (const field of data.fields) {
    if (field.category !== prevCat) {
      prevCat = field.category;
      rows.push({ type: 'cat', label: catLabels[field.category] ?? field.category });
    }
    rows.push({ type: 'field', field });
  }

  render(html`
    <div class="coverage-legend">
      <span class="coverage-cell coverage-full" style="display:inline-block;padding:2px 6px;border-radius:3px;">\u2713 Full</span>
      <span class="coverage-cell coverage-partial" style="display:inline-block;padding:2px 6px;border-radius:3px;">\u25D0 Partial</span>
      <span class="coverage-cell coverage-low" style="display:inline-block;padding:2px 6px;border-radius:3px;">\u25D0 Low</span>
      <span class="coverage-cell coverage-miss" style="display:inline-block;padding:2px 6px;border-radius:3px;">\u2717 Never</span>
      <span class="coverage-cell coverage-none" style="display:inline-block;padding:2px 6px;border-radius:3px;">\u2014 No data</span>
    </div>
    <div style="overflow-x:auto;">
      <table class="coverage-table">
        <thead>
          <tr>
            <th>Field</th>
            ${data.harnesses.map(h => html`<th>${h}</th>`)}
          </tr>
        </thead>
        <tbody>
          ${rows.map(row => {
            if (row.type === 'cat') {
              return html`<tr class="coverage-cat-row"><td colspan=${data.harnesses.length + 1} class="coverage-cat">${row.label}</td></tr>`;
            }
            const field = row.field;
            const autoClass = field.category === 'auto-computed' ? 'coverage-auto' : '';
            return html`<tr>
              <td class=${autoClass}>${field.label}</td>
              ${data.harnesses.map(h => {
                const cell = data.matrix[field.name]?.[h];
                if (!cell || cell.total === 0) {
                  return html`<td class="coverage-cell coverage-none" title="No data">\u2014</td>`;
                }
                const ratio = cell.populated / cell.total;
                const isAbsoluteZero = cell.populated === 0;
                const cls = isAbsoluteZero ? 'coverage-miss' : ratio < 0.5 ? 'coverage-low' : ratio < 1 ? 'coverage-partial' : 'coverage-full';
                const glyph = isAbsoluteZero ? '\u2717' : ratio < 1 ? '\u25D0' : '\u2713';
                const pctStr = (ratio * 100).toFixed(0) + '%';
                return html`<td class=${'coverage-cell ' + cls} title=${cell.populated + '/' + cell.total + ' (' + pctStr + ')'}>${glyph} <small>${pctStr}</small></td>`;
              })}
            </tr>`;
          })}
        </tbody>
      </table>
    </div>
  `, container);
}

function renderPreviewView(container: HTMLElement, data: ParserPreviewData, focusField?: string, onFieldClick?: (fieldName: string) => void): void {
  if (data.samples.length === 0) {
    render(html`<p class="muted">No sample data available.</p>`, container);
    return;
  }

  const focusLabel = focusField
    ? data.fields.find(f => f.name === focusField)?.label
    : null;

  const catLabels: Record<string, string> = { 'core': 'Core', 'enrichment': 'Enrichment', 'auto-computed': 'Auto-computed' };
  let prevCat = '';
  const rows: Array<{ type: 'cat'; label: string } | { type: 'field'; field: ParserPreviewData['fields'][0] }> = [];
  for (const field of data.fields) {
    if (field.category !== prevCat) {
      prevCat = field.category;
      rows.push({ type: 'cat', label: catLabels[field.category] ?? field.category });
    }
    rows.push({ type: 'field', field });
  }

  render(html`
    <p class="muted" style="margin-bottom:12px;">Best-populated sample per harness${focusLabel ? html` <span class="preview-focus-badge">focused: ${focusLabel}</span>` : ''} \u2014 click a field name to find best sample for that field.</p>
    <div style="overflow-x:auto;"><table class="coverage-table preview-table"><thead><tr>
      <th>Field</th>
      ${data.samples.map(sample => {
        const pct = ((sample.populatedCount / sample.totalFields) * 100).toFixed(0);
        return html`<th title=${sample.workspaceName}>${sample.harness}<br /><small class="muted">${pct}% populated</small></th>`;
      })}
    </tr></thead><tbody>
      ${rows.map(row => {
        if (row.type === 'cat') {
          return html`<tr class="coverage-cat-row"><td colspan=${data.samples.length + 1} class="coverage-cat">${row.label}</td></tr>`;
        }
        const field = row.field;
        const isActive = field.name === focusField;
        return html`<tr>
          <td class=${'preview-field-label' + (isActive ? ' preview-field-active' : '')} data-field=${field.name}
            onClick=${() => onFieldClick?.(field.name)}><code>${field.label}</code></td>
          ${data.samples.map(sample => {
            const f = sample.fields[field.name];
            if (!f) return html`<td class="coverage-cell coverage-none">\u2014</td>`;
            if (f.populated) return html`<td class="coverage-cell coverage-full preview-value" title=${f.value}><span class="preview-val">${f.value}</span></td>`;
            return html`<td class="coverage-cell coverage-miss preview-value"><span class="preview-missing">\u2014</span></td>`;
          })}
        </tr>`;
      })}
    </tbody></table></div>
  `, container);
}
