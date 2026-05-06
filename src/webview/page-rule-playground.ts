/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Rule Playground page: interactive REPL for testing DSL expressions against real data. */

import { DateFilter } from '../core/types';
import { rpc, COLORS } from './shared';
import { html, render } from './render';

interface PlaygroundField {
  name: string;
  type: string;
  scope: string;
  description: string;
}

interface PlaygroundFunction {
  name: string;
  signature: string;
  description: string;
  category: string;
}

interface PlaygroundMetric {
  id: string;
  name: string;
  scope: string;
  filterExpr: string;
}

interface EvaluateExpressionResult {
  error?: string;
  matched?: number;
  total?: number;
  ratio?: number;
  examples?: string[];
}

interface CompileNlRuleResult {
  error?: string;
  markdown?: string;
  usedLlm?: boolean;
  notes?: string[];
}

export async function renderRulePlayground(content: HTMLElement, filter: DateFilter): Promise<void> {
  const [schemaData, funcData, metricData] = await Promise.all([
    rpc<{ fields: PlaygroundField[] }>('getFieldSchema', undefined),
    rpc<{ functions: PlaygroundFunction[] }>('getFunctionCatalog', undefined),
    rpc<{ metrics: PlaygroundMetric[] }>('getMetricList', undefined),
  ]);

  const fields = schemaData.fields ?? [];
  const functions = funcData.functions ?? [];
  const metrics = metricData.metrics ?? [];

  const funcGroups = groupPlaygroundFunctions(functions);

  render(html`
    <div class="playground-header">
      <h2>Rule Playground</h2>
      <p class="playground-subtitle">Test DSL expressions against your real data</p>
    </div>

    <div class="playground-layout">
      <div class="playground-editor">
        <div class="playground-input-area">
          <label>Filter Expression</label>
          <textarea id="playground-expr" rows="3" placeholder="messageLength < 30 AND messageLength > 0" spellcheck="false"></textarea>
          <div class="playground-controls">
            <select id="playground-scope">
              <option value="requests">Requests</option>
              <option value="sessions">Sessions</option>
            </select>
            <button class="btn-primary" id="playground-run">Run</button>
            <button class="btn-secondary" id="playground-nl">From Description...</button>
          </div>
          <div id="playground-error" class="playground-error" style="display:none"></div>
        </div>

        <div id="playground-results" class="playground-results">
          <div class="playground-empty">Write an expression and click Run to see results</div>
        </div>

        <div class="playground-save-area" id="playground-save-area" style="display:none">
          <button class="btn-primary" id="playground-save">Save as Rule</button>
        </div>
      </div>

      <div class="playground-reference">
        <div class="playground-ref-tabs">
          <button class="ref-tab active" data-tab="fields">Fields</button>
          <button class="ref-tab" data-tab="functions">Functions</button>
          <button class="ref-tab" data-tab="metrics">Metrics</button>
        </div>

        <div class="playground-ref-content" id="ref-fields">
          <input type="text" class="ref-search" id="ref-field-search" placeholder="Search fields..." />
          <div class="ref-list">
            ${fields.map(f => html`
              <div class="ref-item" data-insert=${f.name}>
                <span class="ref-name">${f.name}</span>
                <span class="ref-type">${f.type}</span>
                <span class="ref-scope">${f.scope}</span>
                <span class="ref-desc">${f.description}</span>
              </div>
            `)}
          </div>
        </div>

        <div class="playground-ref-content" id="ref-functions" style="display:none">
          ${funcGroups.map(([cat, fns]) => html`
            <h4>${cat}</h4><div class="ref-list">
              ${fns.map(f => html`
                <div class="ref-item" data-insert=${f.name + '()'}>
                  <code class="ref-name">${f.signature}</code>
                  <span class="ref-desc">${f.description}</span>
                </div>
              `)}
            </div>
          `)}
        </div>

        <div class="playground-ref-content" id="ref-metrics" style="display:none">
          <div class="ref-list">
            ${metrics.map(m => html`
              <div class="ref-item" data-insert=${m.filterExpr}>
                <span class="ref-name">${m.id}</span>
                <span class="ref-desc">${m.name} (${m.scope})</span>
                <code class="ref-expr">${m.filterExpr}</code>
              </div>
            `)}
          </div>
        </div>

      </div>
    </div>
  `, content);

  wirePlayground(content, filter);
}

function groupPlaygroundFunctions(functions: Array<{ name: string; signature: string; description: string; category: string }>): [string, typeof functions][] {
  const groups = new Map<string, typeof functions>();
  for (const f of functions) {
    const cat = f.category || 'utility';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(f);
  }
  return [...groups.entries()];
}

function wirePlayground(content: HTMLElement, filter: DateFilter): void {
  const exprInput = content.querySelector('#playground-expr') as HTMLTextAreaElement;
  const scopeSelect = content.querySelector('#playground-scope') as HTMLSelectElement;
  const runBtn = content.querySelector('#playground-run') as HTMLButtonElement;
  const nlBtn = content.querySelector('#playground-nl') as HTMLButtonElement;
  const errorDiv = content.querySelector('#playground-error') as HTMLElement;
  const resultsDiv = content.querySelector('#playground-results') as HTMLElement;
  const saveArea = content.querySelector('#playground-save-area') as HTMLElement;
  const saveBtn = content.querySelector('#playground-save') as HTMLButtonElement;

  let lastExpr = '';

  // Run expression
  async function runExpression(): Promise<void> {
    const expr = exprInput.value.trim();
    if (!expr) return;
    lastExpr = expr;
    errorDiv.style.display = 'none';
    render(html`<div class="loading-spinner"></div>`, resultsDiv);

    const result = await rpc<EvaluateExpressionResult>('evaluateExpression', {
      expr,
      scope: scopeSelect.value,
      filter,
    });

    if (result.error) {
      errorDiv.textContent = result.error;
      errorDiv.style.display = '';
      render(null, resultsDiv);
      saveArea.style.display = 'none';
      return;
    }

    render(html`
      <div class="playground-stats">
        <div class="stat-card"><div class="stat-value">${(result.matched ?? 0).toLocaleString()}</div><div class="stat-label">Matched</div></div>
        <div class="stat-card"><div class="stat-value">${(result.total ?? 0).toLocaleString()}</div><div class="stat-label">Total</div></div>
        <div class="stat-card"><div class="stat-value" style=${'color:' + ((result.ratio ?? 0) > 30 ? COLORS.red : COLORS.green)}>${result.ratio}%</div><div class="stat-label">Rate</div></div>
      </div>
      ${result.examples && result.examples.length > 0 ? html`
        <h4>Sample Matches</h4>
        <div class="playground-examples">
          ${result.examples.map(ex => html`<div class="playground-example">${ex}</div>`)}
        </div>
      ` : null}
    `, resultsDiv);
    saveArea.style.display = '';
  }

  runBtn.addEventListener('click', () => {
    void runExpression();
  });
  exprInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void runExpression();
    }
  });

  // NL compilation
  nlBtn.addEventListener('click', () => {
    void (async () => {
      const prompt = window.prompt('Describe the pattern you want to detect:');
      if (!prompt) return;

      render(html`<div class="loading-spinner"></div>`, resultsDiv);
      const result = await rpc<CompileNlRuleResult>('compileNlRule', {
        prompt,
        scope: scopeSelect.value,
      });

      if (result.error) {
        errorDiv.textContent = result.error;
        errorDiv.style.display = '';
        return;
      }

      const filterMatch = result.markdown?.match(/# Filter\s*\n([\s\S]*?)(?=\n#|$)/);
      if (filterMatch) {
        exprInput.value = filterMatch[1].trim();
      }

      render(html`
        <div class="playground-nl-result">
          <div class="nl-badge">${result.usedLlm ? 'LLM Generated' : 'Heuristic Template'}</div>
          ${result.notes && result.notes.length > 0 ? html`<div class="nl-notes">${result.notes.join('\n')}</div>` : null}
          <pre class="nl-preview">${result.markdown || ''}</pre>
          <button class="btn-primary" id="nl-use">Use This Rule</button>
        </div>
      `, resultsDiv);

      content.querySelector<HTMLElement>('#nl-use')?.addEventListener('click', () => {
        void (async () => {
          if (!result.markdown) return;
          const saved = await rpc<{ ok: boolean }>('saveRule', { markdown: result.markdown });
          if (saved.ok) {
            render(html`<div class="playground-success">Rule saved. Switch to Rule Editor to view it.</div>`, resultsDiv);
          }
        })();
      });
    })();
  });

  // Save expression as rule
  saveBtn.addEventListener('click', () => {
    void (async () => {
      const compiled = await rpc<CompileNlRuleResult>('compileNlRule', {
        prompt: lastExpr,
        scope: scopeSelect.value,
      });

      if (compiled.markdown) {
        let md = compiled.markdown;
        const filterMatch = md.match(/# Filter\s*\n[\s\S]*?(?=\n#|$)/);
        if (filterMatch) {
          md = md.replace(filterMatch[0], `# Filter\n${lastExpr}`);
        }
        const saved = await rpc<{ ok: boolean }>('saveRule', { markdown: md });
        if (saved.ok) {
          render(html`<span class="playground-success">Rule saved.</span>`, saveArea);
        }
      }
    })();
  });

  // Reference tabs
  for (const tab of content.querySelectorAll<HTMLElement>('.ref-tab')) {
    tab.addEventListener('click', () => {
      for (const t of content.querySelectorAll<HTMLElement>('.ref-tab')) t.classList.remove('active');
      tab.classList.add('active');
      const tabName = tab.dataset.tab;
      for (const c of content.querySelectorAll<HTMLElement>('.playground-ref-content')) {
        c.style.display = c.id === `ref-${tabName}` ? '' : 'none';
      }
    });
  }

  // Click-to-insert reference items
  for (const item of content.querySelectorAll<HTMLElement>('.ref-item[data-insert]')) {
    item.addEventListener('click', () => {
      const insert = item.dataset.insert || '';
      const start = exprInput.selectionStart;
      const end = exprInput.selectionEnd;
      exprInput.value = exprInput.value.substring(0, start) + insert + exprInput.value.substring(end);
      exprInput.focus();
      exprInput.setSelectionRange(start + insert.length, start + insert.length);
    });
  }

  // Field search
  const fieldSearch = content.querySelector('#ref-field-search') as HTMLInputElement;
  if (fieldSearch) {
    fieldSearch.addEventListener('input', () => {
      const query = fieldSearch.value.toLowerCase();
      for (const el of content.querySelectorAll<HTMLElement>('#ref-fields .ref-item')) {
        const text = el.textContent?.toLowerCase() || '';
        el.style.display = text.includes(query) ? '' : 'none';
      }
    });
  }
}


