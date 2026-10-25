/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Replay page — "git blame for AI". Strictly read-only.
 *
 * Two views in one route (`'replay'`):
 *   - file view: every session/prompt that edited a file, newest first;
 *     expanding a row lazily reads that one tool call's diff from the
 *     session .jsonl (nothing is held in memory across rows).
 *   - session view: the transcript with a *Files changed* card under each
 *     assistant turn; each row toggles an inline diff.
 *
 * Entry hints (via navHint, JSON): `{"path": "..."}` from the editor context
 * menu, `{"sessionId": "..."}` from Timeline / Session Chat links. */

import { diffLines } from 'diff';
import type { DateFilter, FileChangeRef, Session, SessionRequest } from '../core/types';
import type {
  FileChangePayload,
  FileChangeResult,
  ReplayFileHistory,
  ReplayFileHit,
  ReplayTopFile,
} from '../core/types/replay-types';
import { consumeNavHint, navigateTo, setNavHint } from './app';
import { html, render, ComponentChildren } from './render';
import { rpc } from './shared';

type View = 'file' | 'session';

interface ReplayState {
  view: View;
  features: { atlas: boolean; replay: boolean; sessionChat: boolean; atlasRefine: boolean };
  // file view
  path?: string;
  history?: ReplayFileHistory;
  topFiles?: ReplayTopFile[];
  pickerQuery: string;
  // session view
  sessionId?: string;
  detail?: Session | null;
  /** Key → lazily loaded payload. Key = `${sessionId}:${lineNo}:${toolUseId|path}`. */
  payloads: Map<string, FileChangeResult | 'loading'>;
  expanded: Set<string>;
  error?: string;
}

const UNCHANGED_CONTEXT = 3;

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function fmtDate(ts: number | null): string {
  if (!ts) return '';
  return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function shortId(id: string): string {
  return id.length > 12 ? id.slice(0, 8) : id;
}

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i >= 0 ? p.slice(i + 1) : p;
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
    // Legacy plain string hint: treat as a session id.
    return { sessionId: hint };
  }
}

export function renderReplay(content: HTMLElement, filter: DateFilter): void {
  const state: ReplayState = {
    view: 'file',
    features: { atlas: true, replay: true, sessionChat: true, atlasRefine: false },
    pickerQuery: '',
    payloads: new Map(),
    expanded: new Set(),
  };

  render(html`<div id="replay-root" class="replay-page"></div>`, content);
  const root = content.querySelector('#replay-root') as HTMLElement;
  const hint = parseHint(consumeNavHint());

  void (async () => {
    try {
      const f = await rpc<ReplayState['features']>('understandFeatures');
      state.features = f;
    } catch { /* defaults */ }
    if (!state.features.replay) {
      render(html`
        <div class="chat-ineligible">
          <h3>Replay is turned off</h3>
          <p>Enable it in Settings → AI Engineer Coach → Replay (<code>aiEngineerCoach.replay.enabled</code>).</p>
        </div>`, root);
      return;
    }
    if (hint.sessionId) await openSession(hint.sessionId);
    else await openFile(hint.path);
  })();

  /* ---------------- file view ---------------- */

  async function openFile(path?: string): Promise<void> {
    state.view = 'file';
    state.path = path;
    state.history = undefined;
    state.error = undefined;
    paint();
    try {
      if (path) {
        state.history = await rpc<ReplayFileHistory>('replayFileHistory', { path, filter: filter as unknown as Record<string, unknown> });
      }
      if (!state.topFiles) {
        state.topFiles = await rpc<ReplayTopFile[]>('replayTopFiles', { filter: filter as unknown as Record<string, unknown>, limit: 60 });
      }
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
          <h2>Replay</h2>
          <p class="studio-subtitle">Read-only history of every AI edit, reconstructed from your local session logs. Nothing here modifies files.</p>
        </div>
      </div>
      ${state.error ? html`<div class="studio-error">${state.error}</div>` : null}
      ${state.path && h ? renderFileHeader(h) : null}
      ${state.path && h ? renderHits(h) : null}
      ${state.path && !h && !state.error ? html`<div class="loading-spinner"></div>` : null}
      ${renderPicker()}
    `;
  }

  function renderFileHeader(h: ReplayFileHistory): ComponentChildren {
    const sessions = new Set(h.hits.map(x => x.sessionId)).size;
    const times = h.hits.map(x => x.ts).filter((t): t is number => t !== null);
    const first = times.length ? Math.min(...times) : null;
    const last = times.length ? Math.max(...times) : null;
    return html`
      <div class="replay-file-card">
        <div class="replay-file-title">
          <code class="replay-path" title=${h.path}>${h.path}</code>
          <button class="chat-btn-ghost" id="replay-open-file" title="Open in editor">Open</button>
        </div>
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
          <p>${h.total > 0 ? 'Edits exist outside the current date / workspace filter.' : 'No Claude, Codex or OpenCode session touched this path.'}</p>
          <button class="btn-primary" id="replay-pick-another">Pick another file</button>
        </div>`;
    }
    return html`
      <div class="replay-hits">
        ${h.hits.map(hit => renderHit(hit))}
      </div>`;
  }

  function renderHit(hit: ReplayFileHit): ComponentChildren {
    const key = hit.ref ? changeKey(hit.sessionId, hit.ref) : `${hit.sessionId}:${hit.requestIdx}:nodiff`;
    const open = state.expanded.has(key);
    const payload = state.payloads.get(key);
    return html`
      <div class=${'replay-hit' + (open ? ' open' : '')} data-key=${key}>
        <div class="replay-hit-row" data-toggle=${key}>
          <span class=${'replay-harness replay-harness-' + hit.harness.toLowerCase()}>${hit.harness}</span>
          <span class="replay-hit-ws">${hit.workspaceName}</span>
          <span class="replay-hit-date">${fmtDate(hit.ts)}</span>
          ${hit.ref ? html`<span class="studio-chip">${hit.ref.tool}${hit.ref.editCount ? ` ×${hit.ref.editCount}` : ''}</span>` : html`<span class="studio-chip studio-chip-muted">diff not available</span>`}
          <span class="replay-hit-expander">${open ? '▾' : '▸'}</span>
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

  function renderPicker(): ComponentChildren {
    const q = state.pickerQuery.toLowerCase();
    const files = (state.topFiles ?? []).filter(f => !q || f.path.toLowerCase().includes(q));
    return html`
      <div class="replay-picker">
        <h3>${state.path ? 'Other files' : 'Pick a file'}</h3>
        <p class="studio-note">Right-click any file in the Explorer and choose <em>Show AI History for File</em>, or pick one of the most-edited files below.</p>
        <input type="text" id="replay-picker-input" class="chat-search" placeholder="Filter files or paste a path…" autocomplete="off" value=${state.pickerQuery} />
        ${state.topFiles === undefined ? html`<div class="studio-empty">Loading…</div>` : null}
        ${state.topFiles && files.length === 0 ? html`<div class="studio-empty">No files match.${state.pickerQuery.includes('/') ? html` <button class="chat-btn-ghost" id="replay-picker-go">Look up this path</button>` : null}</div>` : null}
        <div class="replay-top-files">
          ${files.slice(0, 40).map(f => html`
            <div class="replay-top-file" data-path=${f.path} title=${f.path}>
              <span class="replay-top-name">${basename(f.path)}</span>
              <span class="replay-top-dir">${f.path}</span>
              <span class="replay-top-counts">${f.edits} edit${f.edits === 1 ? '' : 's'} · ${f.sessions} session${f.sessions === 1 ? '' : 's'}</span>
            </div>`)}
        </div>
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

  function renderSessionView(): ComponentChildren {
    const s = state.detail;
    const claude = s?.harness === 'Claude';
    return html`
      <div class="replay-header">
        <div>
          <button class="chat-btn-ghost" id="replay-back">← ${state.path ? 'Back to file' : 'Files'}</button>
          <h2>Session ${state.sessionId ? shortId(state.sessionId) : ''}</h2>
          ${s ? html`<p class="studio-subtitle">${s.harness} · ${s.workspaceName} · ${s.requests.length} turn${s.requests.length === 1 ? '' : 's'} · ${fmtDate(s.creationDate)}</p>` : null}
        </div>
        <div class="replay-header-actions">
          <button class="chat-btn-ghost" id="replay-show-atlas" disabled=${!state.features.atlasRefine}
            title=${state.features.atlasRefine ? 'Highlight this session\u2019s files on the latest Atlas map' : 'Available in 2.1 — needs a cached full map and aiEngineerCoach.atlas.refineEnabled'}>Show in Atlas</button>
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
      <div class="chat-turn" id=${'replay-turn-' + idx}>
        <div class="chat-bubble chat-bubble-user">${r.messageText || '(empty)'}</div>
        ${renderToolChips(r.toolsUsed)}
        ${r.responseText ? html`<div class="chat-bubble chat-bubble-assistant">${r.responseText}</div>` : null}
        ${changes.length > 0 || pointerless.length > 0 ? html`
          <div class="replay-files-card">
            <div class="replay-files-title">Files changed <span class="studio-chip">${changes.length || pointerless.length}</span></div>
            ${changes.map(ref => renderChangeRow(s, ref))}
            ${pointerless.map(p => html`
              <div class="replay-change-row">
                <code class="replay-path" data-open-path=${p} title="Open in editor">${p}</code>
                <span class="studio-chip studio-chip-muted">diff not available for ${s.harness}</span>
              </div>`)}
          </div>` : null}
      </div>`;
  }

  function renderChangeRow(s: Session, ref: FileChangeRef): ComponentChildren {
    const key = changeKey(s.sessionId, ref);
    const open = state.expanded.has(key);
    const payload = state.payloads.get(key);
    const counts = payload && payload !== 'loading' && !('error' in payload) ? countLines(payload) : null;
    return html`
      <div class=${'replay-change' + (open ? ' open' : '')}>
        <div class="replay-change-row" data-toggle=${key}>
          <span class="replay-hit-expander">${open ? '▾' : '▸'}</span>
          <code class="replay-path" title=${ref.path}>${ref.path}</code>
          <span class="studio-chip">${ref.tool}${ref.editCount ? ` ×${ref.editCount}` : ''}</span>
          ${counts ? html`<span class="replay-counts"><span class="replay-add">+${counts.added}</span> <span class="replay-del">−${counts.removed}</span></span>` : null}
          ${payload && payload !== 'loading' && !('error' in payload) && payload.toolResultOk === false ? html`<span class="studio-chip replay-chip-failed" title="The tool reported an error — this edit may not have been applied">failed</span>` : null}
          <button class="chat-btn-ghost replay-open-btn" data-open-path=${ref.path} title="Open in editor">Open</button>
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
        // rpc() rejects on `{ error }` payloads — recover the code for stale-index handling.
        state.payloads.set(key, { error: describeError(err) });
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

  /* ---------------- export ---------------- */

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
      if (res.path) {
        state.error = undefined;
        flash(`Exported to ${res.path}`);
      }
    } catch (err) {
      state.error = describeError(err);
      paint();
    }
  }

  function flash(text: string): void {
    const el = root.querySelector<HTMLElement>('#replay-flash');
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    setTimeout(() => { el.hidden = true; }, 4000);
  }

  /* ---------------- paint + wiring ---------------- */

  function paint(): void {
    render(html`
      <div id="replay-flash" class="chat-banner chat-banner-info" hidden></div>
      ${state.view === 'file' ? renderFileView() : renderSessionView()}
    `, root);
    wire();
  }

  function wire(): void {
    for (const el of root.querySelectorAll<HTMLElement>('[data-toggle]')) {
      el.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        void toggle(el.dataset.toggle || '');
      });
    }
    for (const el of root.querySelectorAll<HTMLElement>('[data-open-session]')) {
      el.addEventListener('click', () => { void openSession(el.dataset.openSession || ''); });
    }
    for (const el of root.querySelectorAll<HTMLElement>('[data-continue]')) {
      el.addEventListener('click', () => {
        setNavHint(el.dataset.continue);
        navigateTo('session-chat');
      });
    }
    root.querySelector<HTMLElement>('#replay-continue')?.addEventListener('click', () => {
      setNavHint(state.sessionId);
      navigateTo('session-chat');
    });
    for (const el of root.querySelectorAll<HTMLElement>('[data-open-path]')) {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        void rpc('openWorkspaceFile', { path: el.dataset.openPath || '' }).catch(() => {});
      });
    }
    root.querySelector<HTMLElement>('#replay-open-file')?.addEventListener('click', () => {
      void rpc('openWorkspaceFile', { path: state.history?.path || state.path || '' }).catch(() => {});
    });
    for (const el of root.querySelectorAll<HTMLElement>('[data-show-content]')) {
      el.addEventListener('click', () => {
        const body = el.closest('.replay-write')?.querySelector<HTMLElement>('.replay-write-body');
        if (!body) return;
        body.hidden = !body.hidden;
        el.textContent = body.hidden ? 'Show content' : 'Hide content';
      });
    }
    root.querySelector<HTMLElement>('#replay-reload')?.addEventListener('click', () => {
      void rpc('reloadData').catch(() => {});
    });
    root.querySelector<HTMLElement>('#replay-back')?.addEventListener('click', () => { void openFile(state.path); });
    root.querySelector<HTMLElement>('#replay-pick-another')?.addEventListener('click', () => { void openFile(undefined); });
    root.querySelector<HTMLElement>('#replay-export')?.addEventListener('click', () => { void exportMarkdown(); });
    root.querySelector<HTMLElement>('#replay-show-atlas')?.addEventListener('click', () => {
      if (!state.features.atlasRefine || !state.detail) return;
      setNavHint(JSON.stringify({ overlaySessionId: state.detail.sessionId }));
      navigateTo('atlas');
    });
    for (const el of root.querySelectorAll<HTMLElement>('.replay-top-file')) {
      el.addEventListener('click', () => { void openFile(el.dataset.path); });
    }
    const picker = root.querySelector<HTMLInputElement>('#replay-picker-input');
    if (picker) {
      picker.addEventListener('input', () => {
        state.pickerQuery = picker.value;
        const list = root.querySelector<HTMLElement>('.replay-top-files');
        if (!list) return;
        // Re-render just the list to keep focus in the input.
        const q = state.pickerQuery.toLowerCase();
        const files = (state.topFiles ?? []).filter(f => !q || f.path.toLowerCase().includes(q)).slice(0, 40);
        render(html`${files.map(f => html`
          <div class="replay-top-file" data-path=${f.path} title=${f.path}>
            <span class="replay-top-name">${basename(f.path)}</span>
            <span class="replay-top-dir">${f.path}</span>
            <span class="replay-top-counts">${f.edits} edit${f.edits === 1 ? '' : 's'} · ${f.sessions} session${f.sessions === 1 ? '' : 's'}</span>
          </div>`)}`, list);
        for (const el of list.querySelectorAll<HTMLElement>('.replay-top-file')) {
          el.addEventListener('click', () => { void openFile(el.dataset.path); });
        }
      });
      picker.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && picker.value.trim()) void openFile(picker.value.trim());
      });
    }
    root.querySelector<HTMLElement>('#replay-picker-go')?.addEventListener('click', () => { void openFile(state.pickerQuery.trim()); });
  }
}
