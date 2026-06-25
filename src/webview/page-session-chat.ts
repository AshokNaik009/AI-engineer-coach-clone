/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Session Chat page: continue any locally stored Claude Code session from the
 * dashboard. One `claude -p --resume` spawn per turn (Phase 1: no streaming,
 * no tools). The turn is appended to the same ~/.claude session jsonl by the
 * CLI itself, so all analytics see the full conversation on the next reload.
 *
 * Guardrails encoded here:
 *   - one-time consent card (writes to session history + spends Claude usage)
 *   - six distinct ineligible states with a copyable terminal fallback
 *   - "recently active" concurrent-writer guard with an explicit override
 *   - failed sends are never auto-retried (the failure may mean another
 *     writer won — see the caveats register)
 *   - fork tripwire: a same-session send that comes back with a different id
 *     is flagged loudly. */

import type { DateFilter, Session, SessionList, SessionListItem } from '../core/types';
import type {
  SessionChatEligibility,
  SessionChatTurn,
  SessionChatUsage,
  SessionChatPermissionMode,
  ChatToolUse,
  ChatEvent,
} from '../core/types/session-chat-types';
import { consumeNavHint, getMatchedWorkspaceId } from './app';
import { html, render, ComponentChildren } from './render';
import { rpc, onPush } from './shared';

interface LocalTurn {
  user: string;
  reply: string;
  usage?: SessionChatUsage;
  durationMs?: number;
}

interface ChatState {
  consented: boolean;
  sessions: SessionListItem[];
  totalSessions: number;
  search: string;
  /** 'current' = only the matched VS Code workspace; 'all' = no workspace filter */
  wsScope: 'current' | 'all';
  selectedId?: string;
  detail?: Session | null;
  eligibility?: SessionChatEligibility;
  /** user clicked "Continue anyway" on the recently-active card */
  ignoreRecent: boolean;
  fork: boolean;
  busy: boolean;
  error?: string;
  forkNotice?: string;
  driftWarning?: string;
  localTurns: LocalTurn[];
  cumulativeCostUsd: number;
  /** Phase 2: true when a live stream-json process is open for the current session. */
  liveMode: boolean;
  /** Accumulates assistant text from `delta` events during active streaming. */
  liveText: string;
  /** Tool chips from the `message` event (complete turn). */
  liveToolUses: ChatToolUse[];
  /** User message sent via sessionChatSendLive, waiting for turn-end. */
  pendingLiveMessage: string;
  /** permissionMode the live process was spawned with (from sessionChatOpenLive result). */
  livePermissionMode?: SessionChatPermissionMode;
  /** cwd the live process was spawned in (shown in acceptEdits banner). */
  liveCwd?: string;
}

/** Module-level: unsubscribe from the push channel when the page is replaced.
 *  A leaked subscription across navigations double-appends deltas (spec §4.2). */
let activeUnsub: (() => void) | undefined;

interface ChatEls {
  list: HTMLElement;
  main: HTMLElement;
}

const PAGE_SIZE = 50;

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function relativeDate(ts: number): string {
  const diff = Date.now() - ts;
  const d = Math.floor(diff / 86_400_000);
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Mirrors core terminalResumeCommand (which lives in a node-only module). */
function terminalFallback(sessionId: string, cwd?: string): string {
  const resume = `claude --resume ${sessionId}`;
  if (!cwd) return resume;
  const quoted = /^[A-Za-z0-9_\-./~]+$/.test(cwd) ? cwd : `'${cwd.replaceAll("'", String.raw`'\''`)}'`;
  return `cd ${quoted} && ${resume}`;
}

export function renderSessionChat(content: HTMLElement, filter: DateFilter): void {
  // Clean up any push subscription from the previous activation of this page
  // (spec §4.2: leaked subscriptions double-append deltas).
  activeUnsub?.();
  activeUnsub = undefined;

  const currentWsId = getMatchedWorkspaceId();

  const state: ChatState = {
    consented: false,
    sessions: [],
    totalSessions: 0,
    search: '',
    wsScope: currentWsId ? 'current' : 'all',
    ignoreRecent: false,
    fork: false,
    busy: false,
    localTurns: [],
    cumulativeCostUsd: 0,
    liveMode: false,
    liveText: '',
    liveToolUses: [],
    pendingLiveMessage: '',
  };

  render(html`<div id="chat-root"></div>`, content);
  const root = content.querySelector('#chat-root') as HTMLElement;

  const deepLinkId = consumeNavHint();

  void (async () => {
    let consented = false;
    try {
      consented = (await rpc<{ consented: boolean }>('sessionChatConsent', {})).consented;
    } catch { /* treat as not consented */ }
    state.consented = consented;
    if (!state.consented) {
      renderConsentCard(root, () => {
        void rpc('sessionChatConsent', { ack: true }).catch(() => { /* best effort */ });
        state.consented = true;
        void boot();
      });
      return;
    }
    await boot();
  })();

  async function boot(): Promise<void> {
    render(html`
      <div class="chat-page">
        <div class="chat-list-col">
          <div class="chat-list-header">
            <input type="text" id="chat-search" class="chat-search" placeholder="Search sessions…" autocomplete="off" />
            ${currentWsId ? html`
              <div class="chat-ws-toggle">
                <button class=${'chat-ws-btn' + (state.wsScope === 'current' ? ' active' : '')} id="chat-ws-current">This workspace</button>
                <button class=${'chat-ws-btn' + (state.wsScope === 'all' ? ' active' : '')} id="chat-ws-all">All</button>
              </div>` : null}
          </div>
          <div id="chat-session-list" class="chat-session-list"><div class="studio-empty">Loading…</div></div>
        </div>
        <div class="chat-main-col" id="chat-main">
          <div class="chat-empty-state">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" opacity="0.3"><path d="M6 6h20a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H12l-6 4V8a2 2 0 0 1 2-2z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M11 13h10M11 17h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            <span>Select a session to continue it</span>
          </div>
        </div>
      </div>
    `, root);

    const els: ChatEls = {
      list: root.querySelector('#chat-session-list') as HTMLElement,
      main: root.querySelector('#chat-main') as HTMLElement,
    };

    const searchInput = root.querySelector('#chat-search') as HTMLInputElement;
    let searchTimer = 0;
    searchInput.addEventListener('input', () => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => {
        state.search = searchInput.value.trim();
        void loadSessions(els);
      }, 250);
    });

    root.querySelector('#chat-ws-current')?.addEventListener('click', () => {
      state.wsScope = 'current';
      updateWsToggle(root);
      void loadSessions(els);
    });
    root.querySelector('#chat-ws-all')?.addEventListener('click', () => {
      state.wsScope = 'all';
      updateWsToggle(root);
      void loadSessions(els);
    });

    await loadSessions(els);
    if (deepLinkId) await selectSession(deepLinkId, els);
  }

  function updateWsToggle(root: HTMLElement): void {
    root.querySelector('#chat-ws-current')?.classList.toggle('active', state.wsScope === 'current');
    root.querySelector('#chat-ws-all')?.classList.toggle('active', state.wsScope === 'all');
  }

  async function loadSessions(els: ChatEls): Promise<void> {
    const wsFilter = state.wsScope === 'current' && currentWsId ? { workspaceId: currentWsId } : {};
    try {
      const res = await rpc<SessionList>('getSessions', {
        page: 1,
        pageSize: PAGE_SIZE,
        filter: { ...filter, ...wsFilter, harness: 'Claude' } as unknown as Record<string, unknown>,
        search: state.search || undefined,
      });
      state.sessions = res.sessions;
      state.totalSessions = res.total;
    } catch (err) {
      render(html`<div class="studio-error">${describeError(err)}</div>`, els.list);
      return;
    }
    renderSessionList(els);
  }

  function renderSessionList(els: ChatEls): void {
    if (state.sessions.length === 0) {
      render(html`<div class="studio-empty">No Claude sessions${state.search ? ' match your search' : ' found'}.</div>`, els.list);
      return;
    }
    render(html`
      ${state.sessions.map(s => html`
        <div class=${'chat-session-item' + (s.sessionId === state.selectedId ? ' selected' : '')} data-sid=${s.sessionId}>
          <div class="chat-session-msg">${s.firstMessage || '(no prompt)'}</div>
          <div class="chat-session-meta">
            ${state.wsScope === 'all' ? html`<span class="chat-session-ws">${s.workspaceName}</span>` : null}
            <span>${s.requestCount} turn${s.requestCount === 1 ? '' : 's'}</span>
            <span>${s.lastMessageDate ? relativeDate(s.lastMessageDate) : ''}</span>
          </div>
        </div>`)}
      ${state.totalSessions > state.sessions.length
        ? html`<div class="chat-session-more">+${state.totalSessions - state.sessions.length} more — search to narrow</div>`
        : null}
    `, els.list);
    for (const item of els.list.querySelectorAll<HTMLElement>('.chat-session-item')) {
      item.addEventListener('click', () => { void selectSession(item.dataset.sid || '', els); });
    }
  }

  async function selectSession(sessionId: string, els: ChatEls): Promise<void> {
    if (!sessionId || state.busy) return;

    // Close the previous live process and unsubscribe from its push events.
    if (state.selectedId && state.liveMode) {
      void rpc('sessionChatCloseLive', { sessionId: state.selectedId }).catch(() => {});
    }
    activeUnsub?.();
    activeUnsub = undefined;

    state.selectedId = sessionId;
    state.detail = undefined;
    state.eligibility = undefined;
    state.ignoreRecent = false;
    state.fork = false;
    state.error = undefined;
    state.forkNotice = undefined;
    state.driftWarning = undefined;
    state.localTurns = [];
    state.cumulativeCostUsd = 0;
    state.liveMode = false;
    state.liveText = '';
    state.liveToolUses = [];
    state.pendingLiveMessage = '';
    state.livePermissionMode = undefined;
    state.liveCwd = undefined;
    renderSessionList(els);
    render(html`<div class="loading-spinner"></div>`, els.main);

    try {
      // Run detail, eligibility, and live-mode open in parallel.
      type OpenLiveResult = { ok: boolean; error?: string; permissionMode?: SessionChatPermissionMode; cwd?: string };
      const [detail, eligibility, openLive] = await Promise.all([
        rpc<Session | null>('getSessionDetail', { sessionId }),
        rpc<SessionChatEligibility>('sessionChatEligibility', { sessionId }),
        rpc<OpenLiveResult>('sessionChatOpenLive', { sessionId }).catch((): OpenLiveResult => ({ ok: false })),
      ]);
      if (state.selectedId !== sessionId) return; // user clicked elsewhere meanwhile
      state.detail = detail;
      state.eligibility = eligibility;

      if (openLive.ok) {
        state.liveMode = true;
        state.livePermissionMode = openLive.permissionMode;
        state.liveCwd = openLive.cwd;
        // Wire the push subscription for this session's stream events.
        activeUnsub = onPush('sessionChat', (msg) => {
          if (state.selectedId !== sessionId) return;
          handleLiveEvent(msg.event as ChatEvent, els);
        });
      }
    } catch (err) {
      if (state.selectedId !== sessionId) return;
      render(html`<div class="studio-error">${describeError(err)}</div>`, els.main);
      return;
    }
    renderMain(els);
  }

  /** Live elapsed-timer id — cleared on turn-end / closed. */
  let liveElapsedTimer = 0;

  function handleLiveEvent(event: ChatEvent, els: ChatEls): void {
    if (event.kind === 'delta') {
      state.liveText += event.text;
      updateStreamingText(els);
    } else if (event.kind === 'message') {
      state.liveText = event.text;
      state.liveToolUses = event.toolUses;
      // Full re-render for the tool chips; still cheaper than delta frequency.
      renderMain(els);
    } else if (event.kind === 'turn-end') {
      window.clearInterval(liveElapsedTimer);
      liveElapsedTimer = 0;
      state.localTurns.push({
        user: state.pendingLiveMessage,
        reply: state.liveText,
        usage: event.usage,
        durationMs: undefined,
      });
      state.cumulativeCostUsd += event.usage?.costUsd ?? 0;
      // Drift tripwire: resume-by-id reusing the session id is load-bearing.
      const sentId = state.selectedId;
      if (event.sessionId && event.sessionId !== sentId && !state.fork) {
        state.driftWarning = `Warning: the CLI replied under a different session id (${event.sessionId}) — this turn may have forked instead of continuing. Your original session file was likely not updated.`;
      }
      state.liveText = '';
      state.liveToolUses = [];
      state.pendingLiveMessage = '';
      state.busy = false;
      renderMain(els);
    } else if (event.kind === 'closed') {
      window.clearInterval(liveElapsedTimer);
      liveElapsedTimer = 0;
      // The process died or was idle-killed. If a turn was in progress, surface the error.
      if (state.busy && event.error) {
        state.error = `Live chat process closed: ${event.error}`;
      }
      state.liveMode = false;
      state.liveText = '';
      state.liveToolUses = [];
      state.pendingLiveMessage = '';
      if (state.busy) {
        state.busy = false;
        renderMain(els);
      }
    }
  }

  /** Lightweight delta update: only mutates the streaming text node's content. */
  function updateStreamingText(els: ChatEls): void {
    const streamText = els.main.querySelector<HTMLElement>('#chat-stream-text');
    if (streamText) {
      streamText.textContent = state.liveText || '…';
      const transcript = els.main.querySelector<HTMLElement>('#chat-transcript');
      if (transcript) transcript.scrollTop = transcript.scrollHeight;
    } else {
      renderMain(els);
    }
  }

  function renderMain(els: ChatEls): void {
    const eligibility = state.eligibility;
    if (!state.selectedId || !eligibility) return;

    const blocked = !eligibility.eligible
      && !(eligibility.reason === 'recently-active' && state.ignoreRecent);

    render(html`
      ${state.livePermissionMode && state.livePermissionMode !== 'none' ? html`
        <div class="chat-banner chat-banner-warn">
          Tools active: <strong>${state.livePermissionMode}</strong> mode${
            state.liveCwd ? html` — working directory: <code>${state.liveCwd}</code>` : null}
        </div>` : null}
      <div class="chat-transcript" id="chat-transcript">
        ${renderTranscript()}
        ${state.busy && state.liveMode ? html`
          <div class="chat-turn chat-turn-streaming">
            <div class="chat-bubble chat-bubble-user">${state.pendingLiveMessage}</div>
            ${renderToolChips(state.liveToolUses.map(t => t.name))}
            <div class="chat-bubble chat-bubble-assistant chat-bubble-streaming" id="chat-stream-text">${state.liveText || '…'}</div>
          </div>` : null}
      </div>
      ${state.forkNotice ? html`<div class="chat-banner chat-banner-info">${state.forkNotice}</div>` : null}
      ${state.driftWarning ? html`<div class="chat-banner chat-banner-warn">${state.driftWarning}</div>` : null}
      ${state.error ? html`
        <div class="chat-banner chat-banner-error">
          <span>${state.error}</span>
          <button class="chat-btn-ghost" id="chat-dismiss-error">Dismiss & edit message</button>
        </div>` : null}
      ${blocked ? renderIneligible(eligibility) : renderComposer()}
      <div class="chat-cost-footer">
        ${state.cumulativeCostUsd > 0
          ? html`<span>Session cost: $${state.cumulativeCostUsd.toFixed(3)}</span><span class="chat-cost-sep">·</span>`
          : null}
        <span>Turns become visible to analytics on next reload</span>
      </div>
    `, els.main);

    const transcript = els.main.querySelector<HTMLElement>('#chat-transcript');
    if (transcript) transcript.scrollTop = transcript.scrollHeight;

    els.main.querySelector<HTMLButtonElement>('#chat-dismiss-error')?.addEventListener('click', () => {
      state.error = undefined;
      renderMain(els);
    });

    els.main.querySelector<HTMLButtonElement>('#chat-interrupt')?.addEventListener('click', () => {
      void rpc('sessionChatInterrupt', { sessionId: state.selectedId || '' }).catch(() => {});
    });

    wireIneligibleActions(els);
    wireComposer(els);
  }

  function renderTranscript(): ComponentChildren {
    const requests = state.detail?.requests ?? [];
    if (requests.length === 0 && state.localTurns.length === 0) {
      return html`<div class="studio-empty">${state.detail === null
        ? 'Transcript not available in the dashboard cache — you can still continue the session below.'
        : 'No messages parsed for this session yet.'}</div>`;
    }
    return html`
      ${requests.map(r => html`
        <div class="chat-turn">
          <div class="chat-bubble chat-bubble-user">${r.messageText || '(empty)'}</div>
          ${renderToolChips(r.toolsUsed)}
          ${r.responseText ? html`<div class="chat-bubble chat-bubble-assistant">${r.responseText}</div>` : null}
        </div>`)}
      ${state.localTurns.map(t => html`
        <div class="chat-turn chat-turn-new">
          <div class="chat-bubble chat-bubble-user">${t.user}</div>
          <div class="chat-bubble chat-bubble-assistant">${t.reply}</div>
          <div class="chat-turn-meta">
            ${t.durationMs ? `${(t.durationMs / 1000).toFixed(1)}s` : ''}
            ${t.usage?.costUsd != null ? ` · $${t.usage.costUsd.toFixed(3)}` : ''}
            ${t.usage?.outputTokens != null ? ` · ${t.usage.outputTokens} out tokens` : ''}
          </div>
        </div>`)}
    `;
  }

  function renderToolChips(toolsUsed: string[]): ComponentChildren {
    if (!toolsUsed || toolsUsed.length === 0) return null;
    const counts = new Map<string, number>();
    for (const t of toolsUsed) counts.set(t, (counts.get(t) || 0) + 1);
    return html`<div class="chat-tool-chips">
      ${[...counts.entries()].map(([name, n]) => html`<span class="studio-chip" title=${`${n}× ${name}`}>${name}${n > 1 ? ` ×${n}` : ''}</span>`)}
    </div>`;
  }

  function renderIneligible(eligibility: SessionChatEligibility): ComponentChildren {
    const titles: Record<string, string> = {
      'feature-disabled': 'Session Chat is turned off',
      'not-claude': 'Not a Claude session',
      'no-session-file': 'Session file not found',
      'no-cwd': 'No working directory recorded',
      'cwd-missing': 'Project directory is gone',
      'recently-active': 'Session may have another writer',
      'cli-missing': 'Claude CLI not found',
    };
    const showFallback = eligibility.reason === 'no-cwd' || eligibility.reason === 'cwd-missing' || eligibility.reason === 'recently-active';
    const fallback = terminalFallback(state.selectedId || '', eligibility.resolvedCwd);
    return html`
      <div class="chat-ineligible">
        <h3>${titles[eligibility.reason || ''] || 'This session cannot be continued'}</h3>
        <p>${eligibility.detail || ''}</p>
        ${eligibility.reason === 'recently-active'
          ? html`<button class="btn-primary" id="chat-continue-anyway">Continue anyway</button>`
          : null}
        ${showFallback ? html`
          <p class="chat-fallback-label">Terminal fallback${eligibility.reason === 'cwd-missing' ? ' (may not resolve — the original directory is gone)' : ''}:</p>
          <div class="chat-fallback-row">
            <code class="chat-fallback-cmd" id="chat-fallback-cmd">${fallback}</code>
            <button class="chat-btn-ghost" id="chat-copy-fallback">Copy</button>
          </div>` : null}
      </div>`;
  }

  function wireIneligibleActions(els: ChatEls): void {
    els.main.querySelector<HTMLButtonElement>('#chat-continue-anyway')?.addEventListener('click', () => {
      state.ignoreRecent = true;
      renderMain(els);
    });
    const copyBtn = els.main.querySelector<HTMLButtonElement>('#chat-copy-fallback');
    copyBtn?.addEventListener('click', () => {
      const cmd = els.main.querySelector<HTMLElement>('#chat-fallback-cmd')?.textContent || '';
      void navigator.clipboard?.writeText(cmd);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
    });
  }

  function renderComposer(): ComponentChildren {
    if (state.busy) {
      return html`
        <div class="chat-composer chat-composer-busy">
          <div class="loading-spinner"></div>
          <span>${state.liveMode ? 'Claude is typing…' : 'Waiting…'} <span id="chat-elapsed">0s</span></span>
          ${state.liveMode ? html`<button class="chat-btn-ghost" id="chat-interrupt">Stop</button>` : null}
        </div>`;
    }
    return html`
      <div class="chat-composer">
        ${state.ignoreRecent ? html`<div class="chat-banner chat-banner-warn" style="margin-bottom:6px">Concurrent-writer guard overridden — another writer may interleave.</div>` : null}
        <div class="chat-input-row">
          <textarea id="chat-input" class="chat-input" rows="2" spellcheck="false"
            placeholder="Message…"></textarea>
          <button class="chat-send-btn" id="chat-send" title="Send (⌘↵)">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M13.5 8L2.5 2.5l2.5 5.5-2.5 5.5L13.5 8z" fill="currentColor"/></svg>
          </button>
        </div>
        <div class="chat-composer-meta">
          <label class="chat-fork-toggle" title="Branch into a new session instead of appending to this one">
            <input type="checkbox" id="chat-fork" checked=${state.fork} /> Fork session
          </label>
          <span class="chat-hint">⌘↵ to send</span>
        </div>
      </div>`;
  }

  function wireComposer(els: ChatEls): void {
    const input = els.main.querySelector<HTMLTextAreaElement>('#chat-input');
    const sendBtn = els.main.querySelector<HTMLButtonElement>('#chat-send');
    const forkBox = els.main.querySelector<HTMLInputElement>('#chat-fork');
    if (!input || !sendBtn) return;
    if (forkBox) {
      forkBox.checked = state.fork;
      forkBox.addEventListener('change', () => { state.fork = forkBox.checked; });
    }
    sendBtn.addEventListener('click', () => { void send(input.value, els); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void send(input.value, els);
      }
    });
    input.focus();
  }

  async function send(message: string, els: ChatEls): Promise<void> {
    const sessionId = state.selectedId;
    if (!sessionId || !message.trim() || state.busy) return;
    state.busy = true;
    state.error = undefined;
    state.driftWarning = undefined;
    const wasFork = state.fork;

    // Phase 2: live streaming path.
    if (state.liveMode) {
      state.pendingLiveMessage = message;
      renderMain(els);
      const startedAt = Date.now();
      liveElapsedTimer = window.setInterval(() => {
        const el = els.main.querySelector<HTMLElement>('#chat-elapsed');
        if (el) el.textContent = `${Math.round((Date.now() - startedAt) / 1000)}s`;
      }, 1000);
      let accepted = false;
      try {
        const res = await rpc<{ accepted: boolean }>('sessionChatSendLive', { sessionId, message });
        accepted = res.accepted;
      } catch { /* process died */ }
      if (!accepted) {
        // Process died since we opened it — fall back to Phase 1 path.
        window.clearInterval(liveElapsedTimer);
        liveElapsedTimer = 0;
        state.liveMode = false;
        state.pendingLiveMessage = '';
        state.busy = false;
        renderMain(els);
        const input = els.main.querySelector<HTMLTextAreaElement>('#chat-input');
        if (input) input.value = message;
        return;
      }
      // busy stays true; turn-end / closed events arrive via handleLiveEvent.
      return;
    }

    // Phase 1: request/response (non-streaming fallback).
    renderMain(els);
    const startedAt = Date.now();
    const elapsedTimer = window.setInterval(() => {
      const el = els.main.querySelector<HTMLElement>('#chat-elapsed');
      if (el) el.textContent = `${Math.round((Date.now() - startedAt) / 1000)}s`;
    }, 1000);

    let turn: SessionChatTurn | undefined;
    let sendError: string | undefined;
    try {
      turn = await rpc<SessionChatTurn>('sessionChatSend', {
        sessionId,
        message,
        fork: wasFork,
        ignoreRecentActivity: state.ignoreRecent,
      });
    } catch (err) {
      // Error turns are rejected by the rpc layer; never auto-retry — the
      // failure may mean another writer won the session file.
      sendError = describeError(err);
    } finally {
      window.clearInterval(elapsedTimer);
    }
    state.busy = false;

    if (!turn || sendError) {
      state.error = sendError || 'Send failed.';
      renderMain(els);
      // Put the unsent message back so the user can retry deliberately.
      const input = els.main.querySelector<HTMLTextAreaElement>('#chat-input');
      if (input) input.value = message;
      return;
    }

    state.localTurns.push({ user: message, reply: turn.reply, usage: turn.usage, durationMs: turn.durationMs });
    state.cumulativeCostUsd += turn.usage?.costUsd ?? 0;

    if (turn.sessionId && turn.sessionId !== sessionId) {
      if (wasFork) {
        state.forkNotice = `Branched into new session ${turn.sessionId} — further messages continue the branch. The original session is unchanged; the branch appears in analytics after the next reload.`;
        state.selectedId = turn.sessionId;
        state.fork = false;
        state.ignoreRecent = false;
      } else {
        // Tripwire: resume-by-id reusing the session id is load-bearing for
        // analytics. If a future CLI flips the default, say so loudly.
        state.driftWarning = `Warning: the CLI replied under a different session id (${turn.sessionId}) than requested — this turn may have forked instead of continuing. Your original session file was likely not updated.`;
      }
    } else if (wasFork) {
      state.driftWarning = 'Fork was requested but the CLI echoed the same session id — the turn was appended to the original session.';
    }

    renderMain(els);
  }

  function renderConsentCard(container: HTMLElement, onAccept: () => void): void {
    render(html`
      <div class="chat-consent">
        <h3>Before you continue sessions from here…</h3>
        <p>This extension is read-only by default. Session Chat is the opt-in exception:</p>
        <ul>
          <li><strong>It writes.</strong> Every turn is appended by the Claude CLI to the session's history under <code>~/.claude/projects/</code> (forks create a new session file).</li>
          <li><strong>It spends.</strong> Each turn replays the session transcript as input tokens and bills your Claude API key or subscription.</li>
          <li><strong>No tools run.</strong> Replies are conversation-only (<code>--allowedTools ""</code>) in this version.</li>
        </ul>
        <button class="btn-primary" id="chat-consent-accept">I understand — continue</button>
      </div>
    `, container);
    container.querySelector<HTMLButtonElement>('#chat-consent-accept')?.addEventListener('click', onAccept);
  }
}
