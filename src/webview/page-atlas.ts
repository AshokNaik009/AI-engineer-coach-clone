/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Atlas page — control surface for Archify-generated codebase maps (spec §4.4).
 *
 * Guardrails encoded here:
 *   - opening the page never generates; every run is a deliberate click after
 *     a scope estimate (model, size, expected time/usage) — §2.4 / §5.3;
 *   - seven distinct ineligible cards (the skill-missing one opens a terminal
 *     with the install command);
 *   - staleness banners never auto-regenerate;
 *   - the L3 refinement composer and Replay overlay are flag-gated
 *     (`atlas.refineEnabled`) and designed in for 2.1. */

import type { DateFilter } from '../core/types';
import type {
  AtlasEligibility,
  AtlasGenerateParams,
  AtlasMapMeta,
  AtlasProgressEvent,
  AtlasScopeEstimate,
  AtlasStaleness,
} from '../core/types/atlas-types';
import { consumeNavHint } from './app';
import { renderClaudeConsentCard } from './consent-card';
import { html, render, ComponentChildren } from './render';
import { rpc, onPush } from './shared';

interface AtlasState {
  features: { atlas: boolean; atlasRefine: boolean; atlasExplain: boolean };
  eligibility?: AtlasEligibility;
  estimate?: AtlasScopeEstimate;
  maps: AtlasMapMeta[];
  staleness: Record<string, AtlasStaleness>;
  /** Pending generate request shown as the pre-run estimate card. */
  pending?: AtlasGenerateParams;
  run?: { runId: string; log: string[]; status: string; startedAt: number };
  lastError?: { message: string; stderrTail?: string };
  flash?: string;
  refineFor?: string;
}

let activeUnsub: (() => void) | undefined;
let elapsedTimer = 0;

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function fmtBytes(n: number): string {
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Calibrated from docs/spikes/archify-2026-10.md §4. */
function estimateCopy(e: AtlasScopeEstimate): { time: string; usage: string } {
  if (e.hint === 'small') return { time: '2–4 minutes', usage: 'a small' };
  if (e.hint === 'medium') return { time: '4–8 minutes', usage: 'a moderate' };
  return { time: '8–10+ minutes (may hit the timeout — consider mapping a sub-folder)', usage: 'a large' };
}

export function renderAtlas(content: HTMLElement, _filter: DateFilter): void {
  activeUnsub?.();
  activeUnsub = undefined;
  window.clearInterval(elapsedTimer);

  const state: AtlasState = {
    features: { atlas: true, atlasRefine: true, atlasExplain: true },
    maps: [],
    staleness: {},
  };

  render(html`<div id="atlas-root" class="atlas-page"></div>`, content);
  const root = content.querySelector('#atlas-root') as HTMLElement;
  const hint = parseHint(consumeNavHint());

  void (async () => {
    try {
      const f = await rpc<{ atlas: boolean; atlasRefine: boolean; atlasExplain: boolean }>('understandFeatures');
      state.features = f;
    } catch { /* defaults */ }
    await refresh();
    // Progress pushes for a run that may already be in flight (page re-entry).
    activeUnsub = onPush('atlas', (msg) => handlePush(msg.runId as string, msg.event as AtlasProgressEvent));
    if (hint.notice) {
      state.flash = hint.notice;
      paint();
    }
    if (hint.overlaySessionId && state.features.atlasRefine) {
      const base = state.maps.find(m => m.kind === 'full');
      state.pending = { kind: 'session-overlay', sourceSessionId: hint.overlaySessionId, baseMapId: base?.id };
      paint();
    } else if (hint.explainSessionId && state.features.atlasExplain) {
      state.pending = { kind: 'explainer', sourceSessionId: hint.explainSessionId };
      paint();
    }
  })();

  async function refresh(): Promise<void> {
    try {
      state.eligibility = await rpc<AtlasEligibility>('atlasEligibility');
    } catch (err) {
      state.eligibility = { eligible: false, reason: 'feature-disabled', detail: describeError(err) };
    }
    if (state.eligibility.reason !== 'feature-disabled') {
      try {
        const res = await rpc<{ maps: AtlasMapMeta[]; staleness: Record<string, AtlasStaleness>; activeRunId?: string }>('atlasListMaps');
        state.maps = res.maps;
        state.staleness = res.staleness;
        if (res.activeRunId && !state.run) {
          state.run = { runId: res.activeRunId, log: ['(run already in progress)'], status: 'Working…', startedAt: Date.now() };
          startElapsed();
        }
      } catch (err) {
        state.lastError = { message: describeError(err) };
      }
    }
    paint();
  }

  /* ---------------- pushes ---------------- */

  function handlePush(runId: string, event: AtlasProgressEvent): void {
    if (!state.run || state.run.runId !== runId) {
      if (event.kind === 'done' || event.kind === 'error' || event.kind === 'cancelled') { void refresh(); }
      return;
    }
    if (event.kind === 'status') {
      state.run.status = event.text;
      state.run.log.push(event.text);
    } else if (event.kind === 'tool') {
      state.run.log.push(`${event.name}${event.summary ? `  ${event.summary}` : ''}`);
      if (event.name === 'Bash' && /archify\.mjs/.test(event.summary)) state.run.status = 'Rendering and checking the diagram…';
      else if (event.name === 'Read' || event.name === 'Grep' || event.name === 'Glob') state.run.status = `Reading ${event.summary || 'the repository'}…`;
      else if (event.name === 'Write' || event.name === 'Edit') state.run.status = 'Writing the diagram definition…';
    } else if (event.kind === 'done') {
      stopRun();
      state.flash = `Map ready: ${event.map.title}${event.map.costUsd != null ? ` · $${event.map.costUsd.toFixed(2)}` : ''}`;
      void refresh().then(() => { void rpc('atlasOpenMap', { mapId: event.map.id }).catch(() => {}); });
      return;
    } else if (event.kind === 'error') {
      stopRun();
      state.lastError = { message: event.message, stderrTail: event.stderrTail };
    } else if (event.kind === 'cancelled') {
      stopRun();
      state.flash = 'Run cancelled — no map was saved.';
    }
    if (state.run && state.run.log.length > 400) state.run.log.splice(0, state.run.log.length - 400);
    paintProgress();
    if (!state.run) paint();
  }

  function stopRun(): void {
    state.run = undefined;
    window.clearInterval(elapsedTimer);
  }

  function startElapsed(): void {
    window.clearInterval(elapsedTimer);
    elapsedTimer = window.setInterval(() => {
      const el = root.querySelector<HTMLElement>('#atlas-elapsed');
      if (el && state.run) el.textContent = `${Math.round((Date.now() - state.run.startedAt) / 1000)}s`;
    }, 1000);
  }

  /* ---------------- actions ---------------- */

  async function prepare(params: AtlasGenerateParams): Promise<void> {
    state.pending = params;
    state.lastError = undefined;
    if (!state.estimate) {
      try { state.estimate = await rpc<AtlasScopeEstimate>('atlasEstimate'); } catch (err) { state.lastError = { message: describeError(err) }; }
    }
    paint();
  }

  async function generate(): Promise<void> {
    const params = state.pending;
    if (!params) return;
    state.pending = undefined;
    state.lastError = undefined;
    try {
      const res = await rpc<{ runId: string }>('atlasGenerate', params as unknown as Record<string, unknown>);
      state.run = { runId: res.runId, log: [], status: 'Starting Claude…', startedAt: Date.now() };
      startElapsed();
    } catch (err) {
      const message = describeError(err);
      state.lastError = { message: message === 'run-in-progress' ? 'Another Atlas run is already in progress for this workspace.' : message };
    }
    paint();
  }

  /* ---------------- rendering ---------------- */

  function paint(): void {
    render(html`
      <div class="atlas-header">
        <div>
          <h2>Atlas</h2>
          <p class="studio-subtitle">An Archify-generated, source-linked map of this workspace. Click any source reference in a map to open the file. Maps live in extension storage until you export one.</p>
        </div>
        <div class="atlas-header-actions">
          <button class="chat-btn-ghost" id="atlas-refresh">Refresh</button>
        </div>
      </div>
      ${state.flash ? html`<div class="chat-banner chat-banner-info">${state.flash}</div>` : null}
      ${renderEligibility()}
      ${state.pending ? renderEstimate() : null}
      <div id="atlas-progress-slot">${renderProgress()}</div>
      ${state.lastError ? renderError() : null}
      ${renderMaps()}
    `, root);
    wire();
  }

  function paintProgress(): void {
    const slot = root.querySelector<HTMLElement>('#atlas-progress-slot');
    if (slot) { render(renderProgress(), slot); wireProgress(); }
  }

  function renderEligibility(): ComponentChildren {
    const e = state.eligibility;
    if (!e) return html`<div class="loading-spinner"></div>`;
    if (e.eligible) return null;
    if (e.reason === 'consent-missing') {
      // Rendered imperatively after paint (needs its own listeners).
      return html`<div id="atlas-consent-slot"></div>`;
    }
    const titles: Record<string, string> = {
      'feature-disabled': 'Atlas is turned off',
      'no-workspace': 'No folder open',
      'workspace-untrusted': 'Workspace is in Restricted Mode',
      'cli-missing': 'Claude CLI not found',
      'cli-too-old': 'Claude CLI is too old',
      'skill-missing': 'Archify skill not installed',
    };
    return html`
      <div class="chat-ineligible">
        <h3>${titles[e.reason || ''] || 'Atlas is not available'}</h3>
        <p>${e.detail || ''}</p>
        ${e.reason === 'skill-missing' ? html`
          <div class="chat-fallback-row">
            <code class="chat-fallback-cmd">npx skills add tt-a1i/archify -g</code>
            <button class="btn-primary" id="atlas-install-skill">Install</button>
          </div>
          <p class="studio-note">Needs Node ≥ 22.2 on PATH. Re-open this page after the install finishes.</p>` : null}
        ${e.reason === 'cli-missing' ? html`<p class="studio-note">Install Claude Code, then run <code>claude</code> once in a terminal to sign in.</p>` : null}
      </div>`;
  }

  function renderEstimate(): ComponentChildren {
    const p = state.pending!;
    const est = state.estimate;
    const copy = est ? estimateCopy(est) : null;
    const repoName = state.eligibility?.workspaceRoot?.split(/[\\/]/).pop() || 'this workspace';
    const what = p.kind === 'explainer' ? `Explain session ${p.sourceSessionId?.slice(0, 8)}`
      : p.kind === 'session-overlay' ? `Overlay session ${p.sourceSessionId?.slice(0, 8)} on ${p.baseMapId ? 'the latest full map' : 'a fresh map'}`
      : p.baseMapId ? `Refine map: "${p.instruction}"`
      : `Map ${repoName}`;
    return html`
      <div class="atlas-card atlas-estimate">
        <h3>${what}</h3>
        ${est && copy ? html`
          <div class="atlas-estimate-line">~<strong>${est.fileCount.toLocaleString()}</strong> tracked files · <strong>${fmtBytes(est.approxBytes)}</strong>. Expect roughly <strong>${copy.time}</strong> and <strong>${copy.usage}</strong> amount of Claude usage.</div>`
          : html`<div class="atlas-estimate-line"><span class="loading-spinner replay-spinner"></span> Estimating scope…</div>`}
        <div class="atlas-estimate-line">Model: <strong>${est?.model || 'your Claude CLI default'}</strong> <span class="studio-note">(set <code>aiEngineerCoach.atlas.model</code>; the spike mapped this repo for ~$0.50 on sonnet vs ~$2 on opus)</span></div>
        <div class="atlas-estimate-line studio-note">Claude reads this workspace and writes the HTML to extension storage only. Nothing is written into the repository.</div>
        <div class="atlas-estimate-actions">
          <button class="btn-primary" id="atlas-generate" disabled=${!est}>Generate</button>
          <button class="chat-btn-ghost" id="atlas-cancel-pending">Cancel</button>
        </div>
      </div>`;
  }

  function renderProgress(): ComponentChildren {
    const r = state.run;
    if (!r) return null;
    return html`
      <div class="atlas-progress">
        <div class="atlas-progress-head">
          <div class="loading-spinner"></div>
          <span>${r.status}</span>
          <span class="studio-note" id="atlas-elapsed">${Math.round((Date.now() - r.startedAt) / 1000)}s</span>
          <button class="chat-btn-ghost" id="atlas-cancel-run" style="margin-left:auto">Cancel</button>
        </div>
        <div class="atlas-progress-log" id="atlas-log">${r.log.slice(-60).map(l => html`<div>${l}</div>`)}</div>
      </div>`;
  }

  function renderError(): ComponentChildren {
    const e = state.lastError!;
    return html`
      <div class="chat-banner chat-banner-error">
        <div>
          <div>${e.message}</div>
          ${e.stderrTail ? html`<pre class="atlas-error-tail">${e.stderrTail}</pre>` : null}
          ${/chrome|chromium|browser/i.test((e.message + (e.stderrTail ?? ''))) ? html`<div class="studio-note">Archify's final check needs Chrome, Chromium or Edge. Install one or set <code>ARCHIFY_CHROME</code>.</div>` : null}
          <div class="studio-note">Terminal fallback: <code class="chat-fallback-cmd">claude "Use Archify to map this repository"</code></div>
        </div>
        <button class="chat-btn-ghost" id="atlas-dismiss-error">Dismiss</button>
      </div>`;
  }

  function renderMaps(): ComponentChildren {
    const e = state.eligibility;
    if (!e || e.reason === 'feature-disabled' || e.reason === 'no-workspace') return null;
    const canGenerate = e.eligible && !state.run && !state.pending;
    return html`
      <div class="atlas-maps-head" style="display:flex;align-items:center;gap:10px;margin-top:6px">
        <h3 style="margin:0">Maps${state.maps.length ? ` (${state.maps.length})` : ''}</h3>
        ${e.eligible ? html`<button class="btn-primary" id="atlas-new" disabled=${!canGenerate} title=${state.run ? 'A run is in progress' : 'Shows a scope estimate first'}>New full map…</button>` : null}
      </div>
      ${state.maps.length === 0 ? html`<div class="studio-empty">No maps yet for this workspace.${e.eligible ? ' Click "New full map…" to see the scope estimate.' : ''}</div>` : null}
      <div class="atlas-maps">
        ${state.maps.map(m => renderMap(m))}
      </div>`;
  }

  function renderMap(m: AtlasMapMeta): ComponentChildren {
    const s = state.staleness[m.id];
    const stale = s && s.commitsBehind !== null && s.commitsBehind > 0;
    const canRefine = state.features.atlasRefine && !!m.claudeSessionId && !state.run && !state.pending;
    return html`
      <div class="atlas-map" data-map=${m.id}>
        <div style="min-width:0;flex:1">
          <div class="atlas-map-title">${m.title} <span class="studio-chip studio-chip-muted">${m.kind}</span>
            ${stale ? html`<span class="atlas-stale" title="Commits on HEAD since this map was generated">${s.commitsBehind} commit${s.commitsBehind === 1 ? '' : 's'} behind</span>`
              : s && s.commitsBehind === 0 ? html`<span class="atlas-fresh">current</span>` : null}
            ${m.dirtyAtGeneration ? html`<span class="atlas-stale" title="The working tree had uncommitted changes when this map was generated">generated with uncommitted changes</span>` : null}
          </div>
          <div class="atlas-map-meta">
            <span>${fmtDate(m.createdAt)}</span>
            ${m.headSha ? html`<span title=${m.headSha}>${m.headSha.slice(0, 7)}</span>` : null}
            ${m.model ? html`<span>${m.model}</span>` : null}
            ${m.durationMs != null ? html`<span>${Math.round(m.durationMs / 1000)}s</span>` : null}
            ${m.costUsd != null ? html`<span>$${m.costUsd.toFixed(2)}</span>` : null}
            ${m.relocatedFrom ? html`<span title=${m.relocatedFrom}>relocated output</span>` : null}
            ${m.baseMapId ? html`<span>refined from ${m.baseMapId.slice(0, 6)}…</span>` : null}
          </div>
          ${state.refineFor === m.id ? html`
            <div class="atlas-refine">
              <input type="text" class="chat-search" id="atlas-refine-input" placeholder="e.g. Highlight the auth path, collapse the parser layer…" autocomplete="off" />
              <button class="btn-primary" id="atlas-refine-go" data-map=${m.id}>Refine…</button>
              <button class="chat-btn-ghost" id="atlas-refine-close">Close</button>
            </div>` : null}
        </div>
        <div class="atlas-map-actions">
          <button class="btn-primary" data-open=${m.id}>Open</button>
          ${stale && state.eligibility?.eligible && !state.run ? html`<button class="chat-btn-ghost" data-regen=${m.id} title="Generate a fresh map at HEAD">Regenerate</button>` : null}
          ${state.features.atlasRefine ? html`<button class="chat-btn-ghost" data-refine=${m.id} disabled=${!canRefine} title=${m.claudeSessionId ? 'Refine with a free-text instruction (resumes the map\u2019s Claude session)' : 'No Claude session recorded for this map'}>Refine</button>` : null}
          <button class="chat-btn-ghost" data-export=${m.id} title="Save a copy into your workspace (the only way Atlas writes to the repo)">Export</button>
          <button class="chat-btn-ghost" data-delete=${m.id}>Delete</button>
        </div>
      </div>`;
  }

  /* ---------------- wiring ---------------- */

  /** The consent card renders imperatively into its slot after each paint;
   *  it carries its own (fresh) listeners because the slot is re-rendered. */
  function wire(): void {
    const consentSlot = root.querySelector<HTMLElement>('#atlas-consent-slot');
    if (consentSlot && !consentSlot.dataset.wired) {
      consentSlot.dataset.wired = '1';
      renderClaudeConsentCard(consentSlot, () => { void refresh(); }, () => {
        render(html`<div class="chat-ineligible"><h3>Claude-powered features are off</h3><p>You can enable them any time from this page or Session Chat. Existing maps stay available below.</p></div>`, consentSlot);
      });
    }
    wireProgress();
  }

  function wireProgress(): void {
    const log = root.querySelector<HTMLElement>('#atlas-log');
    if (log) log.scrollTop = log.scrollHeight;
  }

  function submitRefine(): void {
    const refineGo = root.querySelector<HTMLElement>('#atlas-refine-go');
    const instruction = root.querySelector<HTMLInputElement>('#atlas-refine-input')?.value.trim();
    if (!instruction || !refineGo) return;
    state.refineFor = undefined;
    void prepare({ kind: 'full', baseMapId: refineGo.dataset.map, instruction });
  }

  /* Event delegation: Preact reuses DOM nodes across paints, so per-element
   * listeners would stack up. One root listener, bound once per activation. */
  root.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const button = target.closest<HTMLElement>('button');
    if (!button || button.hasAttribute('disabled')) return;
    const d = button.dataset;
    if (d.open) {
      void rpc<{ ok: boolean; error?: string }>('atlasOpenMap', { mapId: d.open })
        .then(r => { if (!r.ok && r.error) { state.lastError = { message: r.error }; paint(); } })
        .catch(err => { state.lastError = { message: describeError(err) }; paint(); });
      return;
    }
    if (d.regen) { void prepare({ kind: 'full' }); return; }
    if (d.refine) { state.refineFor = d.refine; paint(); root.querySelector<HTMLInputElement>('#atlas-refine-input')?.focus(); return; }
    if (d.export) {
      void rpc<{ path?: string; cancelled?: boolean; error?: string }>('atlasExportMap', { mapId: d.export }).then(r => {
        if (r.path) state.flash = `Exported to ${r.path}`;
        else if (r.error) state.lastError = { message: r.error };
        paint();
      }).catch(err => { state.lastError = { message: describeError(err) }; paint(); });
      return;
    }
    if (d.delete) { void rpc('atlasDeleteMap', { mapId: d.delete }).then(() => refresh()).catch(() => refresh()); return; }
    switch (button.id) {
      case 'atlas-refresh': state.flash = undefined; void refresh(); break;
      case 'atlas-install-skill': void rpc('atlasInstallSkill').catch(() => {}); break;
      case 'atlas-new': void prepare({ kind: 'full' }); break;
      case 'atlas-generate': void generate(); break;
      case 'atlas-cancel-pending': state.pending = undefined; paint(); break;
      case 'atlas-dismiss-error': state.lastError = undefined; paint(); break;
      case 'atlas-refine-close': state.refineFor = undefined; paint(); break;
      case 'atlas-refine-go': submitRefine(); break;
      case 'atlas-cancel-run': if (state.run) void rpc('atlasCancel', { runId: state.run.runId }).catch(() => {}); break;
      default: break;
    }
  });

  root.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).id === 'atlas-refine-input' && e.key === 'Enter') submitRefine();
  });
}

function parseHint(hint: string | undefined): { overlaySessionId?: string; explainSessionId?: string; notice?: string } {
  if (!hint) return {};
  try {
    const parsed = JSON.parse(hint) as Record<string, unknown>;
    return {
      overlaySessionId: typeof parsed.overlaySessionId === 'string' ? parsed.overlaySessionId : undefined,
      explainSessionId: typeof parsed.explainSessionId === 'string' ? parsed.explainSessionId : undefined,
      notice: typeof parsed.notice === 'string' ? parsed.notice : undefined,
    };
  } catch {
    return {};
  }
}
