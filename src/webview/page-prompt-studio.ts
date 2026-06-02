/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Prompt Studio page: a local, Copilot-free surface that diagnoses a prompt,
 * gives specific advice, previews its token cost, and produces an improved
 * prompt via `claude -p`. Two input modes:
 *   - Compose: write a live draft.
 *   - History: pick a real past prompt to coach.
 * This is a compose-then-copy surface by design — there is no API to intercept
 * any agent's input box, so Studio improves prompts you then paste yourself. */

import { DateFilter, StudioDiagnosis, StudioIssue, StudioProfile, StudioRecentPrompt, StudioCost, ClaudeImproveResult } from '../core/types';
import { rpc } from './shared';
import { html, render, ComponentChildren } from './render';

interface StudioState {
  diagnosis?: StudioDiagnosis;
  draftText: string;
  historyLoaded: boolean;
}

interface StudioEls {
  text: HTMLTextAreaElement;
  mode: HTMLSelectElement;
  model: HTMLInputElement;
  refFiles: HTMLInputElement;
  results: HTMLElement;
  suggestion: HTMLElement;
  history: HTMLElement;
  improveBtn: HTMLButtonElement;
}

/** Mirror of core estimateTokens (~4 chars/token) for the client-side delta. */
function estTokens(s: string): number {
  return Math.ceil((s ?? '').length / 4);
}

function hasError(v: unknown): v is { error: string } {
  return typeof v === 'object' && v !== null && typeof (v as { error?: unknown }).error === 'string';
}

export function renderPromptStudio(content: HTMLElement, filter: DateFilter): void {
  const state: StudioState = { draftText: '', historyLoaded: false };

  render(html`
    <div class="studio-header">
      <h2>Prompt Studio</h2>
      <p class="studio-subtitle">Diagnose a prompt, preview its cost, and get an improved version — locally, before you send it.</p>
    </div>

    <div class="studio-tabs">
      <button class="studio-tab active" data-studio-tab="compose">Compose</button>
      <button class="studio-tab" data-studio-tab="history">From History</button>
    </div>

    <div class="studio-layout">
      <div class="studio-input-col">
        <div class="studio-pane" data-studio-pane="compose">
          <label class="studio-label" for="studio-text">Your prompt</label>
          <textarea id="studio-text" class="studio-textarea" rows="9" spellcheck="false"
            placeholder="Paste or write the prompt you're about to send to your AI coding agent…"></textarea>
          <div class="studio-controls">
            <label>Mode
              <select id="studio-mode">
                <option value="chat">Chat / Ask</option>
                <option value="agent">Agent</option>
              </select>
            </label>
            <label>Model
              <input id="studio-model" type="text" placeholder="e.g. claude-opus-4-8 (optional)" />
            </label>
            <label># files referenced
              <input id="studio-reffiles" type="number" min="0" value="0" />
            </label>
          </div>
          <div class="studio-actions">
            <button class="btn-primary" id="studio-improve">Improve Prompt</button>
          </div>
        </div>

        <div class="studio-pane" data-studio-pane="history" style="display:none">
          <p class="studio-history-hint">Pick a past prompt to load it into the composer and coach it.</p>
          <div id="studio-history" class="studio-history">
            <div class="studio-empty">Loading recent prompts…</div>
          </div>
        </div>
      </div>

      <div class="studio-output-col">
        <div id="studio-results" class="studio-results">
          <div class="studio-empty">Write a prompt and click <strong>Improve Prompt</strong> to see issues, your profile, cost, and a stronger version.</div>
        </div>
        <div id="studio-suggestion" class="studio-suggestion-slot"></div>
      </div>
    </div>
  `, content);

  const els: StudioEls = {
    text: content.querySelector('#studio-text') as HTMLTextAreaElement,
    mode: content.querySelector('#studio-mode') as HTMLSelectElement,
    model: content.querySelector('#studio-model') as HTMLInputElement,
    refFiles: content.querySelector('#studio-reffiles') as HTMLInputElement,
    results: content.querySelector('#studio-results') as HTMLElement,
    suggestion: content.querySelector('#studio-suggestion') as HTMLElement,
    history: content.querySelector('#studio-history') as HTMLElement,
    improveBtn: content.querySelector('#studio-improve') as HTMLButtonElement,
  };

  wireStudio(content, filter, state, els);
}

function gatherInput(els: StudioEls): { text: string; agentMode: string; modelId: string; referencedFileCount: number } {
  const refCount = Number.parseInt(els.refFiles.value, 10);
  return {
    text: els.text.value,
    agentMode: els.mode.value,
    modelId: els.model.value.trim(),
    referencedFileCount: Number.isFinite(refCount) && refCount > 0 ? refCount : 0,
  };
}

function wireStudio(content: HTMLElement, filter: DateFilter, state: StudioState, els: StudioEls): void {
  /* ---- Tab switching ---- */
  for (const tab of content.querySelectorAll<HTMLElement>('.studio-tab')) {
    tab.addEventListener('click', () => {
      const name = tab.dataset.studioTab;
      for (const t of content.querySelectorAll<HTMLElement>('.studio-tab')) t.classList.toggle('active', t === tab);
      for (const p of content.querySelectorAll<HTMLElement>('.studio-pane')) {
        p.style.display = p.dataset.studioPane === name ? '' : 'none';
      }
      if (name === 'history' && !state.historyLoaded) {
        state.historyLoaded = true;
        void loadHistory(filter, state, els);
      }
    });
  }

  /* ---- Diagnose (internal first step of the single Improve action) ---- */
  async function diagnose(): Promise<StudioDiagnosis | null> {
    const input = gatherInput(els);
    if (!input.text.trim()) {
      render(html`<div class="studio-empty">Enter a prompt first.</div>`, els.results);
      return null;
    }
    state.draftText = input.text;
    render(html`<div class="loading-spinner"></div>`, els.results);
    const res = await rpc<StudioDiagnosis>('promptStudioDiagnose', { input, filter });
    if (hasError(res)) {
      render(html`<div class="studio-error">${res.error}</div>`, els.results);
      return null;
    }
    state.diagnosis = res;
    renderResults(res, state, els);
    return res;
  }

  /* ---- Single action: diagnose, then improve ---- */
  els.improveBtn.addEventListener('click', () => {
    void (async () => {
      const diagnosis = await diagnose();
      if (!diagnosis) return;
      render(html`<div class="loading-spinner"></div><div class="studio-note">Improving your prompt…</div>`, els.suggestion);
      const res = await rpc<ClaudeImproveResult>('promptStudioImprove', {
        text: state.draftText,
        issues: diagnosis.issues,
        profile: diagnosis.profile,
      });
      if (hasError(res)) {
        render(html`<div class="studio-error">${res.error}</div>`, els.suggestion);
        return;
      }
      renderSuggestion(res, state.draftText, els);
    })();
  });
}

async function loadHistory(filter: DateFilter, state: StudioState, els: StudioEls): Promise<void> {
  const res = await rpc<{ prompts: StudioRecentPrompt[] }>('promptStudioRecentPrompts', { filter, limit: 40 });
  if (hasError(res)) {
    render(html`<div class="studio-error">${res.error}</div>`, els.history);
    return;
  }
  if (res.prompts.length === 0) {
    render(html`<div class="studio-empty">No past prompts found in the current filter.</div>`, els.history);
    return;
  }
  render(html`
    ${res.prompts.map((p, i) => html`
      <div class="studio-history-item" data-idx=${i}>
        <div class="studio-history-preview">${p.preview}</div>
        <div class="studio-history-meta">
          <span>${p.workspaceName || 'unknown'}</span>
          ${p.agentMode ? html`<span class="studio-chip">${p.agentMode}</span>` : null}
          ${p.referencedFileCount > 0 ? html`<span class="studio-chip">${p.referencedFileCount} files</span>` : null}
        </div>
      </div>
    `)}
  `, els.history);

  for (const item of els.history.querySelectorAll<HTMLElement>('.studio-history-item')) {
    item.addEventListener('click', () => {
      const idx = Number.parseInt(item.dataset.idx || '-1', 10);
      const p = res.prompts[idx];
      if (!p) return;
      els.text.value = p.text;
      els.mode.value = p.agentMode === 'agent' ? 'agent' : 'chat';
      els.model.value = p.modelId || '';
      els.refFiles.value = String(p.referencedFileCount);
      // Switch back to Compose so the loaded prompt is editable; the user then
      // clicks Improve Prompt to coach it.
      const composeTab = document.querySelector<HTMLElement>('.studio-tab[data-studio-tab="compose"]');
      composeTab?.click();
      els.text.focus();
    });
  }
}

/* ================================================================== */
/*  Result rendering                                                  */
/* ================================================================== */

function renderCostMeter(cost: StudioCost): ComponentChildren {
  return html`
    <div class="studio-cost">
      <div class="studio-cost-item">
        <span class="studio-cost-value">~${cost.tokens.toLocaleString()}</span>
        <span class="studio-cost-label">est. input tokens</span>
      </div>
      ${cost.reportingEnabled && cost.credits != null
        ? html`<div class="studio-cost-item">
            <span class="studio-cost-value">${cost.credits}</span>
            <span class="studio-cost-label">est. credits${cost.model ? ` · ${cost.model}` : ''}</span>
          </div>`
        : html`<div class="studio-cost-note">Credit cost hidden — token reporting is disabled; showing token estimate only.</div>`}
    </div>`;
}

function renderProfile(profile: StudioProfile): ComponentChildren {
  return html`
    <div class="studio-profile">
      <span class="studio-chip studio-chip-intent">Intent: ${profile.intent}</span>
      ${profile.topPatterns.length > 0
        ? profile.topPatterns.slice(0, 3).map(p => html`<span class="studio-chip" title=${`${p.occurrences} occurrences in your history`}>${p.name}</span>`)
        : html`<span class="studio-chip studio-chip-muted">No history profile${profile.sampleSize === 0 ? '' : ` (${profile.sampleSize} prompts)`}</span>`}
      ${profile.contextGaps.map(g => html`<span class="studio-chip studio-chip-gap">${g}</span>`)}
    </div>`;
}

function renderResults(diagnosis: StudioDiagnosis, _state: StudioState, els: StudioEls): void {
  const { issues, profile, cost } = diagnosis;
  render(html`
    ${renderCostMeter(cost)}
    ${renderProfile(profile)}
    <h3 class="studio-issues-title">Issues${issues.length ? ` (${issues.length})` : ''}</h3>
    ${issues.length === 0
      ? html`<div class="studio-clean">No single-prompt issues detected — see the improved version below.</div>`
      : html`<div class="studio-issues">
          ${issues.map((i: StudioIssue) => html`
            <div class=${'studio-issue sev-' + i.severity}>
              <div class="studio-issue-head">
                <span class=${'studio-sev sev-' + i.severity}>${i.severity}</span>
                <span class="studio-issue-name">${i.ruleName}</span>
              </div>
              <div class="studio-issue-sugg">${i.suggestion}</div>
              ${i.example ? html`<div class="studio-issue-ex">${i.example}</div>` : null}
            </div>`)}
        </div>`}
  `, els.results);
}

function renderSuggestion(result: ClaudeImproveResult, draftText: string, els: StudioEls): void {
  const improvedTokens = estTokens(result.improvedPrompt);
  const draftTokens = estTokens(draftText);
  const delta = improvedTokens - draftTokens;
  const deltaStr = `${delta >= 0 ? '+' : ''}${delta}`;

  render(html`
    <div class="studio-suggestion">
      <div class="studio-sugg-head">
        <h3>Improved prompt</h3>
      </div>
      <textarea class="studio-improved" readonly rows="10"></textarea>
      <div class="studio-sugg-actions">
        <button class="btn-primary" id="studio-copy">Copy</button>
        <span class="studio-token-delta">~${improvedTokens.toLocaleString()} tokens (${deltaStr} vs draft)</span>
      </div>
      ${result.advice.length > 0 ? html`
        <h4>Advice</h4>
        <ul class="studio-advice">${result.advice.map(a => html`<li>${a}</li>`)}</ul>` : null}
      ${result.whatChanged.length > 0 ? html`
        <h4>What changed</h4>
        <ul class="studio-changed">${result.whatChanged.map(w => html`<li>${w}</li>`)}</ul>` : null}
    </div>
  `, els.suggestion);

  // Set the textarea value imperatively (robust across renderers) and wire copy.
  const ta = els.suggestion.querySelector<HTMLTextAreaElement>('.studio-improved');
  if (ta) ta.value = result.improvedPrompt;
  const copyBtn = els.suggestion.querySelector<HTMLButtonElement>('#studio-copy');
  copyBtn?.addEventListener('click', () => {
    void navigator.clipboard?.writeText(result.improvedPrompt);
    copyBtn.textContent = 'Copied!';
    setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
  });
}
