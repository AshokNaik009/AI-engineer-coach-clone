/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Replay page — "git blame for AI". Strictly read-only.
 *
 * Three views in one route (`'replay'`):
 *   - overview (landing): what AI touched in this workspace — files created /
 *     modified / deleted, lines added / removed, sessions — and a ranked file
 *     list; click a file for its history;
 *   - file view: every session/prompt that edited the file, newest first;
 *     expanding a row lazily reads that one tool call's diff;
 *   - session view: the transcript with a *Files changed* card per turn.
 *
 * "Show in Atlas" is instant: it opens the latest Atlas map and selects the
 * node(s) whose verified sources cite the file(s). No Claude run.
 *
 * Entry hints (navHint, JSON): `{"path"}` from the editor context menu,
 * `{"sessionId"}` from Timeline / Session Chat links. */

import { diffLines } from 'diff';
import type { DateFilter, FileChangeRef, Session, SessionRequest } from '../core/types';
import type {
  FileChangePayload,
  FileChangeResult,
  ReplayFileHistory,
  ReplayFileHit,
  ReplayOverview,
  ReplayOverviewFile,
} from '../core/types/replay-types';
import { consumeNavHint, navigateTo, setNavHint } from './app';
import { html, render, ComponentChildren } from './render';
import { rpc } from './shared';

type View = 'overview' | 'file' | 'session';
type Scope = 'workspace' | 'all';

interface ReplayState {
  view: View;
  features: { atlas: boolean; replay: boolean; sessionChat: boolean; atlasRefine: boolean; atlasExplain: boolean };
  workspace: { root?: string; name?: string };
  scope: Scope;
  // overview
  overview?: ReplayOverview | 'loading';
  kindFilter: 'all' | 'created' | 'modified' | 'deleted';
  query: string;
  // file view
  path?: string;
  history?: ReplayFileHistory;
  // session view
  sessionId?: string;
  detail?: Session | null;
  /** Key → lazily loaded payload. Key = `${sessionId}:${lineNo}:${toolUseId|path}`. */
  payloads: Map<string, FileChangeResult | 'loading'>;
  expanded: Set<string>;
  error?: string;
  flash?: string;
}

const UNCHANGED_CONTEXT = 3;

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function fmtDate(ts: number | null): string {
  if (!ts) return '';
  return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtNum(n: number): string {
  return n.toLocaleString();
}

function shortId(id: string): string {
  return id.length > 12 ? id.slice(0, 8) : id;
}

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i >= 0 ? p.slice(i + 1) : p;
}

function dirname(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i >= 0 ? p.slice(0, i) : '';
}

function changeKey(sessionId: string, ref: FileChangeRef): string {
  return `${sessionId}:${ref.lineNo}:${ref.toolUseId ?? ref.path}`;
}

function parseHint(hint: string | undefined): { path?: string; sessionId?: string } {
  if (!hint) return {};
  try {
    const parsed = JSON.parse(hint) as { path?: unknown; sessionId?: unknown };
    return {
      path: typeof parsed.path === 'string' ? parsed.path : undefined,
      sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : undefined,
    };
  } catch {
    return { sessionId: hint }; // legacy plain string hint
  }
}

export function renderReplay(content: HTMLElement, filter: DateFilter): void {
  const state: ReplayState = {
    view: 'overview',
    features: { atlas: true, replay: true, sessionChat: true, atlasRefine: true, atlasExplain: true },
    workspace: {},
    scope: 'workspace',
    kindFilter: 'all',
    query: '',
    payloads: new Map(),
    expanded: new Set(),
  };

  render(html`<div id="replay-root" class="replay-page"></div>`, content);
  const root = content.querySelector('#replay-root') as HTMLElement;
  const hint = parseHint(consumeNavHint());

  void (async () => {
    try {
      const [features, ws] = await Promise.all([
        rpc<ReplayState['features']>('understandFeatures'),
        rpc<{ root?: string; name?: string }>('replayWorkspaceRoot'),
      ]);
      state.features = features;
      state.workspace = ws;
    } catch { /* defaults */ }
    if (!state.workspace.root) state.scope = 'all';
    if (!state.features.replay) {
      render(html`
        <div class="chat-ineligible">
          <h3>Replay is turned off</h3>
          <p>Enable it in Settings → AI Engineer Coach → Replay (<code>aiEngineerCoach.replay.enabled</code>).</p>
        </div>`, root);
      return;
    }
    if (hint.sessionId) await openSession(hint.sessionId);
    else if (hint.path) await openFile(hint.path);
    else await openOverview();
  })();

  /** Relative to the workspace root when inside it. */
  function rel(p: string): string {
    const r = state.workspace.root;
    if (r && (p.startsWith(r + '/') || p.startsWith(r + '\\'))) return p.slice(r.length + 1).replaceAll('\\', '/');
    return p;
  }

  function filterParams(): Record<string, unknown> {
    const { fromDate, toDate, harness } = filter;
    return { fromDate, toDate, harness };
  }

  /* ---------------- overview ---------------- */

  async function openOverview(force = false): Promise<void> {
    state.view = 'overview';
    state.error = undefined;
    if (force || !state.overview || state.overview === 'loading') {
      state.overview = 'loading';
      paint();
      try {
        state.overview = await rpc<ReplayOverview>('replayOverview', {
          filter: filterParams(),
          workspaceRoot: state.scope === 'workspace' ? state.workspace.root : undefined,
        });
      } catch (err) {
        state.error = describeError(err);
        state.overview = undefined;
      }
    }
    paint();
  }

  function renderOverview(): ComponentChildren {
    const o = state.overview;
    return html`
      ${renderPageHeader()}
      ${state.error ? html`<div class="studio-error">${state.error}</div>` : null}
      ${o === 'loading' || !o ? html`<div class="loading-screen"><div class="loading-spinner"></div><div class="loading-text">Reading AI edits${state.scope === 'workspace' && state.workspace.name ? ` in ${state.workspace.name}` : ''}…</div></div>` : renderOverviewBody(o)}
    `;
  }

  function renderPageHeader(): ComponentChildren {
    return html`
      <div class="replay-header">
        <div>
          <h2>Replay</h2>
          <p class="studio-subtitle">What AI changed, reconstructed from your local session logs. Read-only — nothing here modifies files.</p>
        </div>
        <div class="replay-header-actions">
          ${state.workspace.root ? html`
            <div class="chat-ws-toggle">
              <button class=${'chat-ws-btn' + (state.scope === 'workspace' ? ' active' : '')} id="replay-scope-ws" title=${state.workspace.root}>${state.workspace.name || 'This workspace'}</button>
              <button class=${'chat-ws-btn' + (state.scope === 'all' ? ' active' : '')} id="replay-scope-all">All workspaces</button>
            </div>` : null}
        </div>
      </div>`;
  }

  function renderOverviewBody(o: ReplayOverview): ComponentChildren {
    const t = o.totals;
    if (t.files === 0) {
      return html`
        <div class="chat-ineligible">
          <h3>No AI edits recorded${state.scope === 'workspace' ? ' in this workspace' : ''}</h3>
          <p>${state.scope === 'workspace' ? 'Claude Code sessions that edited files under this folder will show up here. Try "All workspaces" to see everything.' : 'No Claude, Codex or OpenCode session recorded a file edit in the current date range.'}</p>
          ${state.scope === 'workspace' ? html`<button class="btn-primary" id="replay-scope-all">Show all workspaces</button>` : null}
        </div>`;
    }
    const q = state.query.toLowerCase();
    const files = o.files.filter(f => (state.kindFilter === 'all' || f.kind === state.kindFilter) && (!q || f.relPath.toLowerCase().includes(q)));
    const maxChange = Math.max(1, ...o.files.map(f => f.added + f.removed));
    const kindChip = (kind: ReplayState['kindFilter'], label: string, n: number) => html`
      <button class=${'replay-kind-chip' + (state.kindFilter === kind ? ' active' : '') + ' kind-' + kind} data-kind=${kind}>${label} <strong>${fmtNum(n)}</strong></button>`;
    return html`
      <div class="replay-stats">
        <div class="stat-card"><div class="stat-value">${fmtNum(t.files)}</div><div class="stat-label">files touched by AI</div></div>
        <div class="stat-card"><div class="stat-value replay-add">+${fmtNum(t.added)}</div><div class="stat-label">lines added</div></div>
        <div class="stat-card"><div class="stat-value replay-del">−${fmtNum(t.removed)}</div><div class="stat-label">lines removed</div></div>
        <div class="stat-card"><div class="stat-value">${fmtNum(t.edits)}</div><div class="stat-label">edits · ${fmtNum(t.sessions)} session${t.sessions === 1 ? '' : 's'}</div></div>
      </div>
      <div class="replay-kinds">
        ${kindChip('all', 'All', t.files)}
        ${kindChip('created', 'Created', t.created)}
        ${kindChip('modified', 'Modified', t.modified)}
        ${kindChip('deleted', 'Deleted since', t.deleted)}
        <input type="text" id="replay-query" class="chat-search replay-query" placeholder="Filter files…" autocomplete="off" value=${state.query} />
      </div>
      ${o.skippedReads > 0 ? html`<div class="studio-note">Line counts stop after 4,000 edits; ${fmtNum(o.skippedReads)} edits were not counted.</div>` : null}
      <div class="replay-file-list" id="replay-file-list">
        ${files.length === 0 ? html`<div class="studio-empty">No files match.</div>` : null}
        ${files.slice(0, 300).map(f => renderOverviewRow(f, maxChange))}
        ${files.length > 300 ? html`<div class="studio-note">${fmtNum(files.length - 300)} more — filter to narrow.</div>` : null}
      </div>`;
  }

  function renderOverviewRow(f: ReplayOverviewFile, maxChange: number): ComponentChildren {
    const total = f.added + f.removed;
    const addPct = total ? Math.round((f.added / total) * 100) : 0;
    const width = Math.max(4, Math.round((total / maxChange) * 100));
    return html`
      <div class=${'replay-file-row kind-' + f.kind} data-file=${f.path} title=${f.path}>
        <span class=${'replay-kind-dot kind-' + f.kind} title=${f.kind}></span>
        <span class="replay-file-name">
          <span class="replay-top-name">${basename(f.relPath)}</span>
          <span class="replay-top-dir">${dirname(f.relPath)}</span>
        </span>
        <span class="replay-file-bar" title=${`+${f.added} −${f.removed}`}>
          <span class="replay-file-bar-track" style=${`width:${width}%`}>
            <span class="replay-file-bar-add" style=${`width:${addPct}%`}></span>
          </span>
        </span>
        <span class="replay-counts"><span class="replay-add">+${fmtNum(f.added)}</span> <span class="replay-del">−${fmtNum(f.removed)}</span>${f.partial ? html`<span class="studio-note" title="Some edits could not be counted (non-Claude harness, oversized or stale)">*</span>` : null}</span>
        <span class="replay-file-meta">${f.edits} edit${f.edits === 1 ? '' : 's'} · ${f.sessions} session${f.sessions === 1 ? '' : 's'}</span>
        <span class="replay-file-actions">
          ${state.features.atlas ? html`<button class="chat-btn-ghost" data-atlas=${f.path} title="Select this file's node on the latest Atlas map">Atlas</button>` : null}
          ${f.kind !== 'deleted' ? html`<button class="chat-btn-ghost" data-open-path=${f.path} title="Open in editor">Open</button>` : null}
        </span>
      </div>`;
  }

  /* ---------------- file view ---------------- */

  async function openFile(path?: string): Promise<void> {
    if (!path) { await openOverview(); return; }
    state.view = 'file';
    state.path = path;
    state.history = undefined;
    state.error = undefined;
    paint();
    try {
      state.history = await rpc<ReplayFileHistory>('replayFileHistory', { path, filter: filterParams() });
    } catch (err) {
      state.error = describeError(err);
    }
    paint();
  }

  function renderFileView(): ComponentChildren {
    const h = state.history;
    return html`
      <div class="replay-header">
        <div>
          <button class="chat-btn-ghost" id="replay-back-overview">← Overview</button>
          <h2>${state.path ? basename(state.path) : 'File'}</h2>
        </div>
        <div class="replay-header-actions">
          ${state.features.atlas ? html`<button class="chat-btn-ghost" id="replay-file-atlas" title="Select this file's node on the latest Atlas map">Show in Atlas</button>` : null}
          <button class="btn-primary" id="replay-open-file" title="Open in editor">Open file</button>
        </div>
      </div>
      ${state.error ? html`<div class="studio-error">${state.error}</div>` : null}
      ${h ? renderFileHeader(h) : null}
      ${h ? renderHits(h) : null}
      ${!h && !state.error ? html`<div class="loading-spinner"></div>` : null}
    `;
  }

  function renderFileHeader(h: ReplayFileHistory): ComponentChildren {
    const sessions = new Set(h.hits.map(x => x.sessionId)).size;
    const times = h.hits.map(x => x.ts).filter((t): t is number => t !== null);
    const first = times.length ? Math.min(...times) : null;
    const last = times.length ? Math.max(...times) : null;
    return html`
      <div class="replay-file-card">
        <code class="replay-path" data-open-path=${h.path} title=${h.path}>${rel(h.path)}</code>
        <div class="replay-file-meta">
          <span>${sessions} session${sessions === 1 ? '' : 's'}</span>
          <span>${h.hits.length} edit${h.hits.length === 1 ? '' : 's'}${h.total !== h.hits.length ? ` (of ${h.total} in all time)` : ''}</span>
          ${first ? html`<span>first ${fmtDate(first)}</span>` : null}
          ${last && last !== first ? html`<span>last ${fmtDate(last)}</span>` : null}
        </div>
      </div>`;
  }

  function renderHits(h: ReplayFileHistory): ComponentChildren {
    if (h.hits.length === 0) {
      return html`
        <div class="chat-ineligible">
          <h3>No AI edits recorded for this file</h3>
          <p>${h.total > 0 ? 'Edits exist outside the current date / harness filter.' : 'No Claude, Codex or OpenCode session touched this path.'}</p>
          <button class="btn-primary" id="replay-back-overview">Back to overview</button>
        </div>`;
    }
    return html`<div class="replay-hits">${h.hits.map(hit => renderHit(hit))}</div>`;
  }

  function renderHit(hit: ReplayFileHit): ComponentChildren {
    const key = hit.ref ? changeKey(hit.sessionId, hit.ref) : `${hit.sessionId}:${hit.requestIdx}:nodiff`;
    const open = state.expanded.has(key);
    const payload = state.payloads.get(key);
    return html`
      <div class=${'replay-hit' + (open ? ' open' : '')} data-key=${key}>
        <div class="replay-hit-row" data-toggle=${key}>
          <span class="replay-hit-expander">${open ? '▾' : '▸'}</span>
          <span class=${'replay-harness replay-harness-' + hit.harness.toLowerCase()}>${hit.harness}</span>
          <span class="replay-hit-ws">${hit.workspaceName}</span>
          ${hit.ref ? html`<span class="studio-chip">${hit.ref.tool}${hit.ref.editCount ? ` ×${hit.ref.editCount}` : ''}</span>` : html`<span class="studio-chip studio-chip-muted">diff not available</span>`}
          <span class="replay-hit-date">${fmtDate(hit.ts)}</span>
        </div>
        <div class="replay-hit-prompt">${hit.userPrompt || '(no prompt text)'}</div>
        <div class="replay-hit-actions">
          <button class="chat-btn-ghost" data-open-session=${hit.sessionId}>Open session</button>
          ${hit.harness === 'Claude' && state.features.sessionChat
            ? html`<button class="chat-btn-ghost" data-continue=${hit.sessionId}>Continue in Session Chat</button>` : null}
        </div>
        ${open ? html`<div class="replay-diff-slot">${renderPayload(hit.harness, payload)}</div>` : null}
      </div>`;
  }

  /* ---------------- session view ---------------- */

  async function openSession(sessionId: string): Promise<void> {
    state.view = 'session';
    state.sessionId = sessionId;
    state.detail = undefined;
    state.error = undefined;
    paint();
    try {
      state.detail = await rpc<Session | null>('getSessionDetail', { sessionId });
    } catch (err) {
      state.error = describeError(err);
    }
    paint();
  }

  function sessionFiles(s: Session): string[] {
    const out = new Set<string>();
    for (const r of s.requests) for (const p of r.fileChanges?.map(c => c.path) ?? r.editedFiles) out.add(p);
    return [...out];
  }

  function renderSessionView(): ComponentChildren {
    const s = state.detail;
    const claude = s?.harness === 'Claude';
    const files = s ? sessionFiles(s) : [];
    const firstPrompt = s?.requests[0]?.messageText?.trim().split('\n')[0] ?? '';
    return html`
      <div class="replay-header">
        <div style="min-width:0">
          <button class="chat-btn-ghost" id="replay-back">← ${state.path ? basename(state.path) : 'Overview'}</button>
          <h2 class="replay-session-title" title=${firstPrompt}>${firstPrompt ? (firstPrompt.length > 90 ? firstPrompt.slice(0, 87) + '…' : firstPrompt) : `Session ${state.sessionId ? shortId(state.sessionId) : ''}`}</h2>
          ${s ? html`
            <div class="replay-file-meta replay-session-meta">
              <span class=${'replay-harness replay-harness-' + s.harness.toLowerCase()}>${s.harness}</span>
              <span>${s.workspaceName}</span>
              <span>${s.requests.length} turn${s.requests.length === 1 ? '' : 's'}</span>
              <span>${files.length} file${files.length === 1 ? '' : 's'} changed</span>
              <span>${fmtDate(s.creationDate)}</span>
              <code class="replay-session-id" title="Session id">${shortId(s.sessionId)}</code>
            </div>` : null}
        </div>
        <div class="replay-header-actions">
          ${state.features.atlas && files.length ? html`<button class="chat-btn-ghost" id="replay-session-atlas" title="Select the nodes this session touched on the latest Atlas map">Show in Atlas</button>` : null}
          ${state.features.atlas && state.features.atlasRefine && claude ? html`<button class="chat-btn-ghost" id="replay-overlay" title="Generate a new Atlas overlay with this session\u2019s files highlighted (runs Claude)">Generate overlay…</button>` : null}
          ${state.features.atlas && state.features.atlasExplain && claude ? html`<button class="chat-btn-ghost" id="replay-explain" title="One-page Archify explainer of what this session changed and why (runs Claude)">Explain…</button>` : null}
          <button class="chat-btn-ghost" id="replay-export" disabled=${!s}>Export Markdown</button>
          ${claude && state.features.sessionChat ? html`<button class="btn-primary" id="replay-continue">Continue in Session Chat</button>` : null}
        </div>
      </div>
      ${state.error ? html`<div class="studio-error">${state.error}</div>` : null}
      ${s === undefined && !state.error ? html`<div class="loading-spinner"></div>` : null}
      ${s === null ? html`<div class="studio-empty">Session not found in the current data set. Try <em>Reload data</em>.</div>` : null}
      ${s ? html`<div class="chat-transcript replay-transcript">${s.requests.map((r, i) => renderTurn(s, r, i))}</div>` : null}
    `;
  }

  function renderTurn(s: Session, r: SessionRequest, idx: number): ComponentChildren {
    const changes: FileChangeRef[] = r.fileChanges ?? [];
    const pointerless = changes.length === 0 ? [...new Set(r.editedFiles)] : [];
    return html`
      <div class="chat-turn replay-turn" id=${'replay-turn-' + idx}>
        <div class="replay-turn-no">Turn ${idx + 1}<span>${fmtDate(r.timestamp)}</span></div>
        <div class="chat-bubble chat-bubble-user">${r.messageText || '(empty)'}</div>
        ${renderToolChips(r.toolsUsed)}
        ${r.responseText ? html`<div class="chat-bubble chat-bubble-assistant">${r.responseText}</div>` : null}
        ${changes.length > 0 || pointerless.length > 0 ? html`
          <div class="replay-files-card">
            <div class="replay-files-title">Files changed <span class="studio-chip">${changes.length || pointerless.length}</span></div>
            ${changes.map(ref => renderChangeRow(s, ref))}
            ${pointerless.map(p => html`
              <div class="replay-change-row">
                <code class="replay-path" data-open-path=${p} title="Open in editor">${rel(p)}</code>
                <span class="studio-chip studio-chip-muted">diff not available for ${s.harness}</span>
              </div>`)}
          </div>` : null}
      </div>`;
  }

  function renderChangeRow(s: Session, ref: FileChangeRef): ComponentChildren {
    const key = changeKey(s.sessionId, ref);
    const open = state.expanded.has(key);
    const payload = state.payloads.get(key);
    const loaded = payload && payload !== 'loading' && !('error' in payload) ? payload : null;
    const counts = loaded ? countLines(loaded) : null;
    return html`
      <div class=${'replay-change' + (open ? ' open' : '')}>
        <div class="replay-change-row" data-toggle=${key}>
          <span class="replay-hit-expander">${open ? '▾' : '▸'}</span>
          <code class="replay-path" title=${ref.path}>${rel(ref.path)}</code>
          <span class="studio-chip">${ref.tool}${ref.editCount ? ` ×${ref.editCount}` : ''}</span>
          ${counts ? html`<span class="replay-counts"><span class="replay-add">+${counts.added}</span> <span class="replay-del">−${counts.removed}</span></span>` : null}
          ${loaded?.toolResultOk === false ? html`<span class="studio-chip replay-chip-failed" title="The tool reported an error — this edit may not have been applied">failed</span>` : null}
          <span class="replay-file-actions">
            ${state.features.atlas ? html`<button class="chat-btn-ghost" data-atlas=${ref.path} title="Select this file's node on the latest Atlas map">Atlas</button>` : null}
            <button class="chat-btn-ghost" data-open-path=${ref.path} title="Open in editor">Open</button>
          </span>
        </div>
        ${open ? html`<div class="replay-diff-slot">${renderPayload('Claude', payload)}</div>` : null}
      </div>`;
  }

  /* ---------------- diff rendering ---------------- */

  function countLines(p: FileChangePayload): { added: number; removed: number } {
    let added = 0;
    let removed = 0;
    for (const e of p.edits) {
      for (const part of diffLines(e.oldString, e.newString)) {
        const n = part.count ?? part.value.split('\n').length;
        if (part.added) added += n;
        else if (part.removed) removed += n;
      }
    }
    return { added, removed };
  }

  function renderPayload(harness: string, payload: FileChangeResult | 'loading' | undefined): ComponentChildren {
    if (harness !== 'Claude') {
      return html`<div class="studio-note">Diffs are reconstructed from Claude Code transcripts only. ${harness} records which files changed but not the edit contents.</div>`;
    }
    if (!payload || payload === 'loading') return html`<div class="loading-spinner replay-spinner"></div>`;
    if ('error' in payload) {
      if (payload.error === 'stale-index') {
        return html`
          <div class="chat-banner chat-banner-warn">
            This session file changed since it was indexed (compaction or a fork rewrote it).
            <button class="chat-btn-ghost" id="replay-reload">Reload data</button>
          </div>`;
      }
      return html`<div class="studio-error">${payload.error}</div>`;
    }
    if (payload.truncated) {
      return html`
        <div class="chat-banner chat-banner-info">
          This ${payload.tool} payload is ${((payload.bytes ?? 0) / 1024).toFixed(0)} KB — above <code>aiEngineerCoach.replay.maxDiffBytes</code>, so it is not rendered inline.
        </div>`;
    }
    if (payload.tool === 'Write') {
      const content = payload.edits[0]?.newString ?? '';
      const n = content ? content.split('\n').length : 0;
      return html`
        <div class="replay-write">
          <div class="replay-write-head">File created / overwritten (${n} line${n === 1 ? '' : 's'})
            <button class="chat-btn-ghost" data-show-content="1">Show content</button>
          </div>
          <pre class="replay-write-body" hidden>${content}</pre>
        </div>`;
    }
    return html`${payload.edits.map((e, i) => html`
      <div class="replay-hunk">
        ${payload.edits.length > 1 ? html`<div class="replay-hunk-title">Edit ${i + 1} of ${payload.edits.length}${e.replaceAll ? ' · replace all' : ''}</div>` : null}
        ${renderDiff(e.oldString, e.newString)}
      </div>`)}`;
  }

  function renderDiff(oldString: string, newString: string): ComponentChildren {
    const parts = diffLines(oldString, newString);
    const rows: ComponentChildren[] = [];
    for (const part of parts) {
      const lines = part.value.replace(/\n$/, '').split('\n');
      const cls = part.added ? 'add' : part.removed ? 'del' : 'ctx';
      const sign = part.added ? '+' : part.removed ? '−' : ' ';
      if (cls === 'ctx' && lines.length > UNCHANGED_CONTEXT * 2 + 1) {
        for (const l of lines.slice(0, UNCHANGED_CONTEXT)) rows.push(html`<div class="replay-line ctx"><span class="replay-sign">${sign}</span>${l}</div>`);
        rows.push(html`<div class="replay-line fold">… ${lines.length - UNCHANGED_CONTEXT * 2} unchanged lines</div>`);
        for (const l of lines.slice(-UNCHANGED_CONTEXT)) rows.push(html`<div class="replay-line ctx"><span class="replay-sign">${sign}</span>${l}</div>`);
        continue;
      }
      for (const l of lines) rows.push(html`<div class=${'replay-line ' + cls}><span class="replay-sign">${sign}</span>${l}</div>`);
    }
    return html`<pre class="replay-diff">${rows}</pre>`;
  }

  function renderToolChips(toolsUsed: string[]): ComponentChildren {
    if (!toolsUsed || toolsUsed.length === 0) return null;
    const counts = new Map<string, number>();
    for (const t of toolsUsed) counts.set(t, (counts.get(t) || 0) + 1);
    return html`<div class="chat-tool-chips">
      ${[...counts.entries()].map(([name, n]) => html`<span class="studio-chip" title=${`${n}× ${name}`}>${name}${n > 1 ? ` ×${n}` : ''}</span>`)}
    </div>`;
  }

  /* ---------------- lazy diff loading ---------------- */

  async function toggle(key: string): Promise<void> {
    if (state.expanded.has(key)) {
      state.expanded.delete(key);
      paint();
      return;
    }
    state.expanded.add(key);
    const ref = findRef(key);
    if (ref && !state.payloads.has(key)) {
      state.payloads.set(key, 'loading');
      paint();
      try {
        const res = await rpc<FileChangePayload>('replayFileChange', {
          sessionId: ref.sessionId, lineNo: ref.ref.lineNo, toolUseId: ref.ref.toolUseId, path: ref.ref.path, tool: ref.ref.tool,
        });
        state.payloads.set(key, res);
      } catch (err) {
        state.payloads.set(key, { error: describeError(err) }); // rpc() rejects on { error } payloads
      }
    }
    paint();
  }

  function findRef(key: string): { sessionId: string; ref: FileChangeRef } | null {
    if (state.view === 'file') {
      for (const hit of state.history?.hits ?? []) {
        if (hit.ref && changeKey(hit.sessionId, hit.ref) === key) return { sessionId: hit.sessionId, ref: hit.ref };
      }
      return null;
    }
    const s = state.detail;
    if (!s) return null;
    for (const r of s.requests) {
      for (const ref of r.fileChanges ?? []) {
        if (changeKey(s.sessionId, ref) === key) return { sessionId: s.sessionId, ref };
      }
    }
    return null;
  }

  /* ---------------- Atlas + export ---------------- */

  function showInAtlas(paths: string[]): void {
    void rpc<{ ok: boolean; error?: string }>('atlasHighlight', { paths }).then(r => {
      if (!r.ok) {
        state.flash = r.error || 'Could not open Atlas.';
        paint();
      }
    }).catch(err => { state.flash = describeError(err); paint(); });
  }

  async function exportMarkdown(): Promise<void> {
    const s = state.detail;
    if (!s) return;
    const lines: string[] = [`# Session ${s.sessionId}`, '', `- Harness: ${s.harness}`, `- Workspace: ${s.workspaceName}`, `- Started: ${fmtDate(s.creationDate)}`, ''];
    for (let i = 0; i < s.requests.length; i++) {
      const r = s.requests[i];
      lines.push(`## Turn ${i + 1} — ${fmtDate(r.timestamp)}`, '', '**User**', '', r.messageText || '(empty)', '');
      if (r.responseText) lines.push('**Assistant**', '', r.responseText, '');
      const refs = r.fileChanges ?? [];
      if (refs.length > 0) {
        lines.push('**Files changed**', '');
        for (const ref of refs) {
          lines.push(`- \`${ref.path}\` (${ref.tool}${ref.editCount ? ` ×${ref.editCount}` : ''})`);
          let payload = state.payloads.get(changeKey(s.sessionId, ref));
          if (!payload || payload === 'loading') {
            try {
              payload = await rpc<FileChangePayload>('replayFileChange', { sessionId: s.sessionId, lineNo: ref.lineNo, toolUseId: ref.toolUseId, path: ref.path, tool: ref.tool });
            } catch (err) {
              payload = { error: describeError(err) };
            }
          }
          if ('error' in payload) { lines.push(`  - diff unavailable: ${payload.error}`); continue; }
          if (payload.truncated) { lines.push(`  - diff omitted (${payload.bytes} bytes > maxDiffBytes)`); continue; }
          for (const e of payload.edits) {
            lines.push('', '```diff');
            for (const part of diffLines(e.oldString, e.newString)) {
              const sign = part.added ? '+' : part.removed ? '-' : ' ';
              for (const l of part.value.replace(/\n$/, '').split('\n')) lines.push(sign + l);
            }
            lines.push('```', '');
          }
        }
        lines.push('');
      } else if (r.editedFiles.length > 0) {
        lines.push('**Files changed** (no diff recorded for this harness)', '');
        for (const p of new Set(r.editedFiles)) lines.push(`- \`${p}\``);
        lines.push('');
      }
    }
    try {
      const res = await rpc<{ path?: string; cancelled?: boolean }>('saveTextFile', {
        content: lines.join('\n'),
        defaultName: `ai-session-${shortId(s.sessionId)}.md`,
      });
      if (res.path) { state.flash = `Exported to ${res.path}`; paint(); }
    } catch (err) {
      state.error = describeError(err);
      paint();
    }
  }

  /* ---------------- paint + delegated wiring ---------------- */

  function paint(): void {
    render(html`
      ${state.flash ? html`<div class="chat-banner chat-banner-info replay-flash"><span>${state.flash}</span><button class="chat-btn-ghost" id="replay-flash-close">Dismiss</button></div>` : null}
      ${state.view === 'overview' ? renderOverview() : state.view === 'file' ? renderFileView() : renderSessionView()}
    `, root);
  }

  /* Preact reuses DOM nodes across paints, so listeners live on the root. */
  root.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const hit = <T extends HTMLElement>(sel: string): T | null => target.closest<T>(sel);

    const openPath = hit('[data-open-path]');
    if (openPath) {
      e.stopPropagation();
      void rpc('openWorkspaceFile', { path: openPath.dataset.openPath || '' }).catch(() => {});
      return;
    }
    const atlas = hit('[data-atlas]');
    if (atlas) { e.stopPropagation(); showInAtlas([atlas.dataset.atlas || '']); return; }
    const showContent = hit('[data-show-content]');
    if (showContent) {
      const body = showContent.closest('.replay-write')?.querySelector<HTMLElement>('.replay-write-body');
      if (body) { body.hidden = !body.hidden; showContent.textContent = body.hidden ? 'Show content' : 'Hide content'; }
      return;
    }
    const openSess = hit('[data-open-session]');
    if (openSess) { void openSession(openSess.dataset.openSession || ''); return; }
    const cont = hit('[data-continue]');
    if (cont) { setNavHint(cont.dataset.continue); navigateTo('session-chat'); return; }
    const kind = hit('[data-kind]');
    if (kind) { state.kindFilter = (kind.dataset.kind as ReplayState['kindFilter']) || 'all'; paint(); return; }

    const button = hit('button');
    switch (button?.id) {
      case 'replay-scope-ws': if (state.scope !== 'workspace') { state.scope = 'workspace'; void openOverview(true); } return;
      case 'replay-scope-all': if (state.scope !== 'all') { state.scope = 'all'; void openOverview(true); } return;
      case 'replay-open-file': void rpc('openWorkspaceFile', { path: state.history?.path || state.path || '' }).catch(() => {}); return;
      case 'replay-file-atlas': showInAtlas([state.history?.path || state.path || '']); return;
      case 'replay-session-atlas': if (state.detail) showInAtlas(sessionFiles(state.detail)); return;
      case 'replay-continue': setNavHint(state.sessionId); navigateTo('session-chat'); return;
      case 'replay-reload': void rpc('reloadData').catch(() => {}); return;
      case 'replay-back': if (state.path) void openFile(state.path); else void openOverview(); return;
      case 'replay-back-overview': state.path = undefined; void openOverview(); return;
      case 'replay-export': void exportMarkdown(); return;
      case 'replay-flash-close': state.flash = undefined; paint(); return;
      case 'replay-overlay':
        if (state.features.atlasRefine && state.detail) { setNavHint(JSON.stringify({ overlaySessionId: state.detail.sessionId })); navigateTo('atlas'); }
        return;
      case 'replay-explain':
        if (state.features.atlasExplain && state.detail) { setNavHint(JSON.stringify({ explainSessionId: state.detail.sessionId })); navigateTo('atlas'); }
        return;
      default: break;
    }
    if (button) return;

    const fileRow = hit('[data-file]');
    if (fileRow) { void openFile(fileRow.dataset.file); return; }
    const toggleEl = hit('[data-toggle]');
    if (toggleEl) void toggle(toggleEl.dataset.toggle || '');
  });

  root.addEventListener('input', (e) => {
    const input = e.target as HTMLInputElement;
    if (input.id !== 'replay-query') return;
    state.query = input.value;
    // Re-render only the list so the input keeps focus.
    const o = state.overview;
    const list = root.querySelector<HTMLElement>('#replay-file-list');
    if (!o || o === 'loading' || !list) return;
    const q = state.query.toLowerCase();
    const files = o.files.filter(f => (state.kindFilter === 'all' || f.kind === state.kindFilter) && (!q || f.relPath.toLowerCase().includes(q)));
    const maxChange = Math.max(1, ...o.files.map(f => f.added + f.removed));
    render(html`${files.length === 0 ? html`<div class="studio-empty">No files match.</div>` : null}${files.slice(0, 300).map(f => renderOverviewRow(f, maxChange))}`, list);
  });
}
