/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Rule Editor page -- configurable analyzer rules with preview, stats, and AI builder */

import { DateFilter, PracticeGroup, PRACTICE_GROUPS } from '../core/types';
import type { RuleSource } from '../core/types/rule-types';
import { rpc, COLORS } from './shared';
import { html, render, type ComponentChildren } from './render';

interface RulePreview {
  ruleId: string;
  ruleName: string;
  triggered: boolean;
  occurrences: number;
  total: number;
  pct: number;
  severity: string;
  group: PracticeGroup;
  previewDescription: string;
  previewExamples: string[];
}

interface RuleLayerInfo {
  layer: 'built-in' | 'personal' | 'project';
  directory: string;
  exists: boolean;
  ruleCount: number;
}

interface RuleDetail {
  id: string;
  name: string;
  group: PracticeGroup;
  severity: string;
  scope: string;
  requiresIdeContext: boolean;
  description: string;
  descriptionTemplate: string;
  suggestionTemplate: string;
  exampleTemplate: string;
  thresholds: Record<string, number>;
  tags: string[];
  source: RuleSource;
  sourceFilePath: string;
  version: number;
  rawSource: string;
}

interface RuleEditorData {
  rules: RuleDetail[];
  previews: RulePreview[];
  layers: RuleLayerInfo[];
}

const GROUP_COLORS: Record<PracticeGroup, string> = {
  'prompt-quality': COLORS.blue,
  'session-hygiene': COLORS.cyan,
  'code-review': COLORS.purple,
  'tool-mastery': COLORS.green,
  'context-management': COLORS.orange,
};

const SEVERITY_LABELS: Record<string, { icon: string; color: string; label: string }> = {
  high: { icon: '!', color: 'var(--red)', label: 'High' },
  medium: { icon: '~', color: 'var(--yellow)', label: 'Medium' },
  low: { icon: '-', color: 'var(--text-muted)', label: 'Low' },
};

function severityBadge(sev: string): ComponentChildren {
  const s = SEVERITY_LABELS[sev] || SEVERITY_LABELS.low;
  return html`<span class="rule-severity-badge" style="--sev-color:${s.color}" title="${s.label} severity">${s.icon} ${s.label}</span>`;
}

function statPill(label: string, value: string | number, color?: string): ComponentChildren {
  return html`<span class="rule-stat-pill" style=${color ? `color:${color}` : undefined}><span class="rule-stat-value">${value}</span><span class="rule-stat-label">${label}</span></span>`;
}

function groupPill(group: PracticeGroup): ComponentChildren {
  const color = GROUP_COLORS[group] || COLORS.blue;
  const name = PRACTICE_GROUPS[group] || group;
  return html`<span class="rule-group-pill" style="--group-color:${color}">${name}</span>`;
}

const SOURCE_STYLES: Record<RuleSource, { icon: string; color: string; label: string }> = {
  'built-in': { icon: 'B', color: 'var(--text-muted)', label: 'Built-in' },
  'personal': { icon: 'P', color: COLORS.blue, label: 'Personal' },
  'project':  { icon: 'W', color: COLORS.green, label: 'Project' },
};

function sourceBadge(source: RuleSource): ComponentChildren {
  const s = SOURCE_STYLES[source] || SOURCE_STYLES['built-in'];
  return html`<span class="rule-source-badge" style="--src-color:${s.color}" title="${s.label} rule">${s.label}</span>`;
}

function thresholdRow(key: string, value: number, ruleId: string): ComponentChildren {
  return html`<div class="rule-threshold-row">
    <label class="rule-threshold-label">${key}</label>
    <input type="number" class="rule-threshold-input" data-rule=${ruleId} data-key=${key} value=${value} step="any" />
  </div>`;
}

export async function renderRuleEditor(container: HTMLElement, currentFilter: DateFilter): Promise<void> {
  const data = await rpc<RuleEditorData>('getRuleEditor', currentFilter as Record<string, unknown>);
  const rules = data.rules || [];
  const previews = data.previews || [];
  const layers = data.layers || [];
  const previewMap = new Map(previews.map(p => [p.ruleId, p]));

  // Stats
  const totalRules = rules.length;
  const triggeredRules = previews.filter(p => p.triggered).length;
  const builtInCount = rules.filter(r => r.source === 'built-in').length;
  const personalCount = rules.filter(r => r.source === 'personal').length;
  const projectCount = rules.filter(r => r.source === 'project').length;

  // Group rules
  const groupedRules = new Map<PracticeGroup, RuleDetail[]>();
  for (const r of rules) {
    if (!groupedRules.has(r.group)) groupedRules.set(r.group, []);
    groupedRules.get(r.group)!.push(r);
  }

  render(html`
    <div class="rule-editor-header">
      <div class="rule-editor-title-row">
        <h1>Analyzer Rules</h1>
        <div class="rule-editor-actions">
          <button class="rule-btn rule-btn-secondary" id="rule-help-btn" title="How rule layers work">? Help</button>
          <button class="rule-btn rule-btn-primary" id="rule-new-btn" title="Create a new custom rule">+ New Rule</button>
          <button class="rule-btn rule-btn-ai" id="rule-ai-btn" title="Use AI to help build a rule">AI Builder</button>
        </div>
      </div>
      <div class="rule-stats-bar">
        ${statPill('Total Rules', totalRules)}
        ${statPill('Triggered', triggeredRules, triggeredRules > 0 ? 'var(--yellow)' : 'var(--green)')}
        ${statPill('Built-in', builtInCount)}
        ${personalCount > 0 ? statPill('Personal', personalCount, COLORS.blue) : null}
        ${projectCount > 0 ? statPill('Project', projectCount, COLORS.green) : null}
      </div>
    </div>

    <div class="rule-search-bar">
      <input type="text" class="rule-search-input" id="rule-search" placeholder="Search rules by name, group, or tag..." />
    </div>

    <div class="rule-list" id="rule-list">
      ${renderGroupedRules(groupedRules, previewMap)}
    </div>

    <div class="rule-detail-panel" id="rule-detail-panel" style="display:none;">
      <div class="rule-detail-header">
        <button class="rule-btn rule-btn-back" id="rule-back-btn">${'←'} Back to Rules</button>
        <div class="rule-detail-actions">
          <button class="rule-btn rule-btn-secondary" id="rule-edit-source-btn">Edit Source</button>
          <button class="rule-btn rule-btn-primary" id="rule-save-btn">Save Changes</button>
        </div>
      </div>
      <div id="rule-detail-content"></div>
    </div>

    <div class="rule-source-modal" id="rule-source-modal" style="display:none;">
      <div class="rule-source-modal-content">
        <div class="rule-source-modal-header">
          <h3>Rule Source (Markdown)</h3>
          <button class="rule-btn rule-btn-secondary" id="rule-source-close">${'×'}</button>
        </div>
        <textarea class="rule-source-editor" id="rule-source-editor" spellcheck=${false}></textarea>
        <div class="rule-source-modal-footer">
          <button class="rule-btn rule-btn-secondary" id="rule-source-cancel">Cancel</button>
          <button class="rule-btn rule-btn-primary" id="rule-source-apply">Apply</button>
        </div>
      </div>
    </div>

    <div class="rule-ai-modal" id="rule-ai-modal" style="display:none;">
      <div class="rule-source-modal-content">
        <div class="rule-source-modal-header">
          <h3>AI Rule Builder</h3>
          <button class="rule-btn rule-btn-secondary" id="rule-ai-close">${'×'}</button>
        </div>
        <div class="rule-ai-body">
          <p class="rule-ai-desc">Describe the anti-pattern you want to detect. The AI will generate a rule definition in markdown format.</p>
          <textarea class="rule-ai-prompt" id="rule-ai-prompt" placeholder="Example: Detect when users paste error messages without context, like just sending a stack trace without explaining what they were trying to do." rows=${4}></textarea>
          <div class="rule-ai-actions">
            <button class="rule-btn rule-btn-ai" id="rule-ai-generate">Generate Rule</button>
          </div>
          <div class="rule-ai-result" id="rule-ai-result" style="display:none;">
            <h4>Generated Rule</h4>
            <textarea class="rule-source-editor" id="rule-ai-output" spellcheck=${false} rows=${20}></textarea>
            <div class="rule-ai-actions">
              <button class="rule-btn rule-btn-primary" id="rule-ai-apply">Add This Rule</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="rule-ai-modal" id="rule-help-modal" style="display:none;">
      <div class="rule-source-modal-content rule-help-content">
        <div class="rule-source-modal-header">
          <h3>Rule Layers</h3>
          <button class="rule-btn rule-btn-secondary" id="rule-help-close">${'×'}</button>
        </div>
        <div class="rule-help-body">
          <p>Rules are loaded from three layers. Higher layers override lower ones when rule IDs match.</p>
          <div class="rule-help-layers">
            <div class="rule-help-layer">
              <div class="rule-help-layer-header">
                <span class="rule-source-badge" style="--src-color:${COLORS.green}">Project</span>
                <span class="rule-help-precedence">Highest priority</span>
              </div>
              <p>Workspace-specific rules. Shared with your team via version control.</p>
              <code class="rule-help-path">${'<workspace>'}/.ai-engineer-coach/rules/*.md</code>
              ${renderLayerStatus(layers, 'project')}
            </div>
            <div class="rule-help-layer">
              <div class="rule-help-layer-header">
                <span class="rule-source-badge" style="--src-color:${COLORS.blue}">Personal</span>
                <span class="rule-help-precedence">Medium priority</span>
              </div>
              <p>Your personal rules. Applied across all workspaces on this machine.</p>
              <code class="rule-help-path">~/.ai-engineer-coach/rules/*.md</code>
              ${renderLayerStatus(layers, 'personal')}
            </div>
            <div class="rule-help-layer">
              <div class="rule-help-layer-header">
                <span class="rule-source-badge" style="--src-color:var(--text-muted)">Built-in</span>
                <span class="rule-help-precedence">Lowest priority</span>
              </div>
              <p>Default rules shipped with the extension. Always available.</p>
              ${renderLayerStatus(layers, 'built-in')}
            </div>
          </div>
          <div class="rule-help-howto">
            <h4>Creating a custom rule</h4>
            <p>Create a <code>.md</code> file in any rule directory above. The filename (without extension) becomes the rule ID.</p>
            <p>To override a built-in rule, create a file with the same name (e.g. <code>lazy-prompting.md</code>) in your personal or project rules directory. Only the thresholds, severity, or templates you change will take effect.</p>
          </div>
        </div>
      </div>
    </div>
  `, container);

  // Wire up search
  const searchInput = document.getElementById('rule-search') as HTMLInputElement;
  searchInput?.addEventListener('input', () => {
    const query = searchInput.value.toLowerCase();
    filterRuleCards(query);
  });

  // Wire up rule card clicks
  document.getElementById('rule-list')?.addEventListener('click', (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('.rule-card');
    const ruleId = card?.dataset.ruleId;
    if (!ruleId) return;
    showRuleDetail(ruleId, rules, previewMap, currentFilter);
  });

  // Wire up back button
  document.getElementById('rule-back-btn')?.addEventListener('click', () => {
    document.getElementById('rule-list')!.style.display = '';
    document.getElementById('rule-detail-panel')!.style.display = 'none';
    document.querySelector('.rule-search-bar')!.setAttribute('style', '');
  });

  // Wire up new rule button
  document.getElementById('rule-new-btn')?.addEventListener('click', () => {
    showNewRuleModal();
  });

  // Wire up AI builder button
  document.getElementById('rule-ai-btn')?.addEventListener('click', () => {
    document.getElementById('rule-ai-modal')!.style.display = 'flex';
  });

  // Wire up help button
  document.getElementById('rule-help-btn')?.addEventListener('click', () => {
    document.getElementById('rule-help-modal')!.style.display = 'flex';
  });
  document.getElementById('rule-help-close')?.addEventListener('click', () => {
    document.getElementById('rule-help-modal')!.style.display = 'none';
  });

  // Wire up AI modal close
  document.getElementById('rule-ai-close')?.addEventListener('click', () => {
    document.getElementById('rule-ai-modal')!.style.display = 'none';
  });

  // Wire up AI generate
  document.getElementById('rule-ai-generate')?.addEventListener('click', () => {
    void (async () => {
      const prompt = (document.getElementById('rule-ai-prompt') as HTMLTextAreaElement)?.value;
      if (!prompt?.trim()) return;
      const btn = document.getElementById('rule-ai-generate') as HTMLButtonElement;
      btn.disabled = true;
      btn.textContent = 'Generating...';
      try {
        const result = await rpc<{ markdown: string }>('generateRule', { prompt });
        const output = document.getElementById('rule-ai-output') as HTMLTextAreaElement;
        output.value = result.markdown;
        document.getElementById('rule-ai-result')!.style.display = '';
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        alert('Failed to generate rule: ' + msg);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Generate Rule';
      }
    })();
  });

  // Wire up AI apply
  document.getElementById('rule-ai-apply')?.addEventListener('click', () => {
    void (async () => {
      const markdown = (document.getElementById('rule-ai-output') as HTMLTextAreaElement)?.value;
      if (!markdown?.trim()) return;
      try {
        await rpc<{ ok: boolean }>('saveRule', { markdown });
        document.getElementById('rule-ai-modal')!.style.display = 'none';
        await renderRuleEditor(container, currentFilter);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        alert('Failed to save rule: ' + msg);
      }
    })();
  });
}

function renderGroupedRules(
  grouped: Map<PracticeGroup, RuleDetail[]>,
  previewMap: Map<string, RulePreview>,
): ComponentChildren[] {
  const groups: PracticeGroup[] = ['prompt-quality', 'session-hygiene', 'code-review', 'tool-mastery', 'context-management'];
  const sections: ComponentChildren[] = [];

  for (const group of groups) {
    const rules = grouped.get(group);
    if (!rules || rules.length === 0) continue;

    const groupName = PRACTICE_GROUPS[group];
    const groupColor = GROUP_COLORS[group];
    const triggeredCount = rules.filter(r => previewMap.get(r.id)?.triggered).length;

    sections.push(html`
      <div class="rule-group-section" data-group=${group}>
        <div class="rule-group-header">
          <span class="rule-group-dot" style="background:${groupColor}"></span>
          <span class="rule-group-name">${groupName}</span>
          <span class="rule-group-count">${rules.length} rules</span>
          ${triggeredCount > 0 ? html`<span class="rule-group-triggered">${triggeredCount} triggered</span>` : null}
        </div>
        <div class="rule-cards">
          ${rules.map(r => renderRuleCard(r, previewMap.get(r.id)))}
        </div>
      </div>
    `);
  }

  return sections;
}

function renderRuleCard(rule: RuleDetail, preview?: RulePreview): ComponentChildren {
  const triggered = preview?.triggered ?? false;
  const occurrences = preview?.occurrences ?? 0;
  const total = preview?.total ?? 0;
  const pct = preview?.pct ?? 0;
  const statusClass = triggered ? 'rule-card-triggered' : 'rule-card-clean';

  return html`
    <div class=${`rule-card ${statusClass}`} data-rule-id=${rule.id} data-tags=${rule.tags.join(',')} data-name=${rule.name.toLowerCase()}>
      <div class="rule-card-top">
        <div class="rule-card-name-row">
          <span class="rule-card-name">${rule.name}</span>
          ${severityBadge(rule.severity)}
          ${sourceBadge(rule.source)}
        </div>
        <div class="rule-card-desc">${rule.description}</div>
      </div>
      <div class="rule-card-stats">
        <div class="rule-card-stat">
          <span class=${`rule-card-stat-value ${triggered ? 'stat-warn' : 'stat-ok'}`}>${occurrences}</span>
          <span class="rule-card-stat-label">flagged</span>
        </div>
        <div class="rule-card-stat">
          <span class="rule-card-stat-value">${total}</span>
          <span class="rule-card-stat-label">total</span>
        </div>
        <div class="rule-card-stat">
          <span class=${`rule-card-stat-value ${triggered ? 'stat-warn' : 'stat-ok'}`}>${pct}%</span>
          <span class="rule-card-stat-label">rate</span>
        </div>
      </div>
      ${rule.tags.length > 0 ? html`<div class="rule-card-tags">${rule.tags.map(t => html`<span class="rule-tag">${t}</span>`)}</div>` : null}
    </div>
  `;
}

function filterRuleCards(query: string): void {
  const cards = document.querySelectorAll<HTMLElement>('.rule-card');
  const sections = document.querySelectorAll<HTMLElement>('.rule-group-section');

  for (const card of cards) {
    const name = card.dataset.name || '';
    const tags = card.dataset.tags || '';
    const ruleId = card.dataset.ruleId || '';
    const matches = !query || name.includes(query) || tags.includes(query) || ruleId.includes(query);
    card.style.display = matches ? '' : 'none';
  }

  for (const section of sections) {
    const visibleCards = section.querySelectorAll('.rule-card:not([style*="display: none"])');
    section.style.display = visibleCards.length > 0 ? '' : 'none';
  }
}

function buildRulePreviewSection(preview: RulePreview | undefined): ComponentChildren {
  const statusColor = preview?.triggered ? 'var(--yellow)' : 'var(--green)';
  return html`
    <div class="rule-detail-section">
      <h3>Current Data Preview</h3>
      <div class="rule-preview-stats">
        ${statPill('Flagged', preview?.occurrences ?? 0, statusColor)}
        ${statPill('Total', preview?.total ?? 0)}
        ${statPill('Rate', `${preview?.pct ?? 0}%`, statusColor)}
        ${statPill('Status', preview?.triggered ? 'TRIGGERED' : 'CLEAN', statusColor)}
      </div>
      ${preview?.previewDescription ? html`<div class="rule-preview-desc">${preview.previewDescription}</div>` : null}
      ${preview && preview.previewExamples.length > 0 ? html`
        <details class="rule-preview-examples">
          <summary>${preview.previewExamples.length} example(s) from your data</summary>
          <ul>${preview.previewExamples.map(ex => html`<li>${ex}</li>`)}</ul>
        </details>
      ` : null}
    </div>
  `;
}

function buildThresholdSection(thresholdEntries: [string, number][], ruleId: string): ComponentChildren {
  if (thresholdEntries.length === 0) return null;
  return html`
    <div class="rule-detail-section">
      <h3>Thresholds</h3>
      <p class="rule-threshold-hint">Adjust these values to tune when this rule triggers. Changes apply immediately to the preview above.</p>
      <div class="rule-thresholds">
        ${thresholdEntries.map(([k, v]) => thresholdRow(k, v, ruleId))}
      </div>
    </div>
  `;
}

function buildRuleTagsSection(tags: string[]): ComponentChildren {
  if (tags.length === 0) return null;
  return html`
    <div class="rule-detail-section">
      <h3>Tags</h3>
      <div class="rule-card-tags">${tags.map(t => html`<span class="rule-tag">${t}</span>`)}</div>
    </div>
  `;
}

function wireRuleThresholdInputs(content: HTMLElement, ruleId: string, currentFilter: DateFilter): void {
  for (const input of content.querySelectorAll<HTMLInputElement>('.rule-threshold-input')) {
    input.addEventListener('change', (e) => {
      const el = e.currentTarget as HTMLInputElement;
      const key = el.dataset.key;
      const value = Number.parseFloat(el.value);
      if (!key || Number.isNaN(value)) return;
      void (async () => {
        try {
          await rpc<{ ok: boolean }>('updateRuleThreshold', { ruleId, key, value });
          const newPreview = await rpc<RulePreview>('getRulePreview', {
            ruleId,
            ...(currentFilter as Record<string, unknown>),
          });
          updatePreviewStats(newPreview);
        } catch {
          // Silently fail
        }
      })();
    });
  }
}

function wireRuleSourceEdit(ruleId: string, currentFilter: DateFilter): void {
  document.getElementById('rule-edit-source-btn')?.addEventListener('click', () => {
    void (async () => {
      try {
        const source = await rpc<{ source: string }>('getRuleSource', { ruleId });
        const modal = document.getElementById('rule-source-modal')!;
        const editor = document.getElementById('rule-source-editor') as HTMLTextAreaElement;
        editor.value = source.source;
        modal.style.display = 'flex';

        document.getElementById('rule-source-close')?.addEventListener('click', () => {
          modal.style.display = 'none';
        });
        document.getElementById('rule-source-cancel')?.addEventListener('click', () => {
          modal.style.display = 'none';
        });
        document.getElementById('rule-source-apply')?.addEventListener('click', () => {
          const markdown = editor.value;
          void (async () => {
            try {
              await rpc<{ ok: boolean }>('saveRule', { markdown, ruleId });
              modal.style.display = 'none';
              const container = document.getElementById('content')!;
              await renderRuleEditor(container, currentFilter);
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              alert('Failed to save: ' + msg);
            }
          })();
        });
      } catch {
        alert('Could not load rule source');
      }
    })();
  });
}

function showRuleDetail(
  ruleId: string,
  rules: RuleDetail[],
  previewMap: Map<string, RulePreview>,
  currentFilter: DateFilter,
): void {
  const rule = rules.find(r => r.id === ruleId);
  if (!rule) return;
  const preview = previewMap.get(ruleId);

  document.getElementById('rule-list')!.style.display = 'none';
  document.querySelector('.rule-search-bar')!.setAttribute('style', 'display:none');
  const panel = document.getElementById('rule-detail-panel')!;
  panel.style.display = '';

  const content = document.getElementById('rule-detail-content')!;
  const thresholdEntries = Object.entries(rule.thresholds);

  render(html`
    <div class="rule-detail-top">
      <div class="rule-detail-name-row">
        <h2>${rule.name}</h2>
        ${severityBadge(rule.severity)}
        ${groupPill(rule.group)}
        ${sourceBadge(rule.source)}
      </div>
      <p class="rule-detail-desc">${rule.description}</p>
      <div class="rule-detail-meta">
        <span>ID: <code>${rule.id}</code></span>
        <span>Scope: <code>${rule.scope}</code></span>
        <span>Version: ${rule.version}</span>
        ${rule.requiresIdeContext ? html`<span>Requires IDE context</span>` : null}
        ${rule.sourceFilePath ? html`<span>File: <code>${rule.sourceFilePath}</code></span>` : null}
      </div>
    </div>

    <div class="rule-detail-sections">
      ${buildRulePreviewSection(preview)}
      ${buildThresholdSection(thresholdEntries, ruleId)}
      <div class="rule-detail-section">
        <h3>When Triggered</h3>
        <div class="rule-template-block">${rule.descriptionTemplate}</div>
      </div>
      <div class="rule-detail-section">
        <h3>How to Improve</h3>
        <div class="rule-template-block">${rule.suggestionTemplate}</div>
      </div>
      ${buildRuleTagsSection(rule.tags)}
    </div>
  `, content);

  wireRuleThresholdInputs(content, ruleId, currentFilter);
  wireRuleSourceEdit(ruleId, currentFilter);
}

function updatePreviewStats(preview: RulePreview): void {
  const statsContainer = document.querySelector<HTMLElement>('.rule-preview-stats');
  if (!statsContainer) return;
  render(html`
    ${statPill('Flagged', preview.occurrences, preview.triggered ? 'var(--yellow)' : 'var(--green)')}
    ${statPill('Total', preview.total)}
    ${statPill('Rate', `${preview.pct}%`, preview.triggered ? 'var(--yellow)' : 'var(--green)')}
    ${statPill('Status', preview.triggered ? 'TRIGGERED' : 'CLEAN', preview.triggered ? 'var(--yellow)' : 'var(--green)')}
  `, statsContainer);
}

function showNewRuleModal(): void {
  const modal = document.getElementById('rule-source-modal')!;
  const editor = document.getElementById('rule-source-editor') as HTMLTextAreaElement;
  editor.value = `---
id: my-custom-rule
name: My Custom Rule
group: prompt-quality
severity: medium
scope: requests
version: 1
tags: [custom]
thresholds:
  myThreshold: 0.5
---

# Description
Describe what this rule detects.

# When Triggered
{{count}} occurrences detected ({{pct}} of requests).

# How to Improve
Explain how to fix this anti-pattern.

# Examples
"{{message}}..."

# Detection Logic
\`\`\`detect
custom: my-custom-logic
check: count > thresholds.myThreshold
\`\`\`
`;
  modal.style.display = 'flex';
}

function renderLayerStatus(layers: RuleLayerInfo[], layerName: string): ComponentChildren {
  const info = layers.find(l => l.layer === layerName);
  if (!info) return html`<span class="rule-help-status rule-help-na">Not applicable</span>`;
  if (!info.exists) return html`<span class="rule-help-status rule-help-missing">Directory not found</span>`;
  return html`<span class="rule-help-status rule-help-ok">${info.ruleCount} rule${info.ruleCount !== 1 ? 's' : ''} loaded</span>`;
}
