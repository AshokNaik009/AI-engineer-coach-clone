/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Webview panel manager -- creates and manages the dashboard webview shell */

import * as vscode from 'vscode';
import { Analyzer } from '../core/analyzer';
import { saveSidebarStats } from '../core/cache';
import { clearCache, findLogsDirs, parseAllLogsViaWorker, ParseResult } from '../core/parser';
import { hasExternalHarnessSources } from '../core/parser-harnesses';
import { runtimeDebug } from '../core/runtime-debug';
import { WebviewMessage } from '../core/types';
import { panelCache } from './panel-cache';
import { clearCatalogCache } from './panel-catalog';
import { getDashboardHtml, getErrorHtml } from './panel-html';
import { getRpcHandler, setLiveChatPushSender, closeAllChatProcesses, setClaudeConsentProvider } from './panel-rpc';
import { PanelRequestService } from './panel-request-service';
import { DashboardSidebarProvider } from './panel-sidebar';
import { SessionsTreeProvider } from './sidebar-sessions';
import { isRequestMessage, postResponse, errorResult } from './panel-shared';
import { AtlasHost } from './panel-atlas';
import { CLAUDE_POWERED_CONSENT_KEY, hasClaudePoweredConsent } from './consent-state';

export { DashboardSidebarProvider } from './panel-sidebar';

export { CLAUDE_POWERED_CONSENT_KEY, hasClaudePoweredConsent, migrateClaudePoweredConsent } from './consent-state';

/* ---- Understand feature flags (settings are kill-switches, §2.1) ---- */

export function readUnderstandFeatures(): { atlas: boolean; replay: boolean; sessionChat: boolean; atlasRefine: boolean; atlasExplain: boolean } {
  const cfg = vscode.workspace.getConfiguration('aiEngineerCoach');
  return {
    atlas: cfg.get<boolean>('atlas.enabled', true),
    replay: cfg.get<boolean>('replay.enabled', true),
    sessionChat: cfg.get<boolean>('sessionChat.enabled', true),
    atlasRefine: cfg.get<boolean>('atlas.refineEnabled', false),
    atlasExplain: cfg.get<boolean>('atlas.explainEnabled', false),
  };
}

/** Resolve a (possibly relative) path against the first workspace folder,
 *  refuse anything escaping it, and open it beside the dashboard. */
export async function openWorkspaceFileBeside(rawPath: string, line?: number): Promise<{ ok: boolean; error?: string }> {
  if (!rawPath) return { ok: false, error: 'Missing path.' };
  const folders = vscode.workspace.workspaceFolders ?? [];
  const path = await import('path');
  const fs = await import('fs');
  let resolved: string | undefined;
  if (path.isAbsolute(rawPath)) {
    resolved = path.normalize(rawPath);
  } else {
    for (const folder of folders) {
      const candidate = path.join(folder.uri.fsPath, rawPath);
      if (fs.existsSync(candidate)) { resolved = candidate; break; }
    }
    resolved ??= folders[0] ? path.join(folders[0].uri.fsPath, rawPath) : undefined;
  }
  if (!resolved) return { ok: false, error: 'No workspace folder open.' };
  if (!fs.existsSync(resolved)) return { ok: false, error: `File not found: ${resolved}` };
  // Replay paths come from session logs and may legitimately point at other
  // repos; only *relative* resolution is confined to the workspace. Absolute
  // paths are still refused if they contain traversal segments.
  if (rawPath.split(/[\\/]/).includes('..')) return { ok: false, error: 'Path traversal refused.' };
  try {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(resolved));
    const editor = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false, preview: true });
    if (line && line > 0) {
      const pos = new vscode.Position(Math.min(line - 1, doc.lineCount - 1), 0);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** The only disk write Replay performs: an explicit save dialog. */
export async function saveTextFileViaDialog(content: string, defaultName: string): Promise<{ path?: string; cancelled?: boolean; error?: string }> {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  const defaultUri = folder ? vscode.Uri.joinPath(folder, defaultName) : undefined;
  const target = await vscode.window.showSaveDialog({ defaultUri, filters: { Markdown: ['md'], 'All files': ['*'] }, saveLabel: 'Export' });
  if (!target) return { cancelled: true };
  try {
    await vscode.workspace.fs.writeFile(target, Buffer.from(content, 'utf-8'));
    return { path: target.fsPath };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export class DashboardPanel {
  private static instance: DashboardPanel | undefined;
  private static readonly viewType = 'aiEngineerCoach';

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly requestService: PanelRequestService;
  private readonly globalState: vscode.Memento;
  private readonly atlas: AtlasHost;
  private readonly disposables: vscode.Disposable[] = [];

  private analyzer: Analyzer | undefined;
  private parseResult: ParseResult | undefined;
  private pendingMessages: Extract<WebviewMessage, { type: 'request' }>[] = [];
  private pendingNavigate: { type: 'push'; topic: 'navigate'; page: string; hint?: string } | undefined;
  private dataReady = false;
  private disposed = false;
  private loading = false;
  private loadCompletedAt = 0;

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.globalState = context.globalState;
    this.requestService = new PanelRequestService(
      this.panel.webview,
      () => this.analyzer,
      () => this.parseResult,
    );

    runtimeDebug('panel', 'constructor');
    this.panel.webview.html = getDashboardHtml(this.panel.webview, this.extensionUri);
    this.panel.onDidChangeViewState((e) => {
      runtimeDebug('panel', 'view-state', `visible=${e.webviewPanel.visible} active=${e.webviewPanel.active}`);
    }, null, this.disposables);
    this.panel.onDidDispose(() => {
      runtimeDebug('panel', 'disposed');
      this.dispose();
    }, null, this.disposables);
    this.panel.webview.onDidReceiveMessage((msg: unknown) => this.handleMessage(msg), null, this.disposables);

    const push = (msg: Record<string, unknown>): void => {
      if (!this.disposed) {
        try { this.panel.webview.postMessage(msg); } catch { /* disposed */ }
      }
    };
    setLiveChatPushSender(push);
    setClaudeConsentProvider(() => hasClaudePoweredConsent(this.globalState));
    this.atlas = new AtlasHost(context, push, () => this.parseResult);

    void this.loadData();
  }

  public static createOrShow(extensionUri: vscode.Uri, context: vscode.ExtensionContext): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (DashboardPanel.instance) {
      runtimeDebug('panel', 'reveal-existing');
      DashboardPanel.instance.panel.reveal(column);
      return;
    }

    runtimeDebug('panel', 'create-new');

    const panel = vscode.window.createWebviewPanel(
      DashboardPanel.viewType,
      'AI Engineer Coach',
      column,
      {
        enableScripts: true,
        // Retaining context prevents expensive re-parse on tab switch.
        // Trade-off: ~10-20MB extra memory when tab is hidden.
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')],
      },
    );

    DashboardPanel.instance = new DashboardPanel(panel, extensionUri, context);
  }

  public static get current(): DashboardPanel | undefined {
    return DashboardPanel.instance;
  }

  public reload(force = false): void {
    if (this.loading) {
      runtimeDebug('panel', 'reload-skipped-loading');
      return;
    }
    // Suppress watcher-triggered reloads within 10s of a completed load
    if (!force && Date.now() - this.loadCompletedAt < 10_000) {
      runtimeDebug('panel', 'reload-skipped-cooldown');
      return;
    }
    runtimeDebug('panel', 'reload');
    closeAllChatProcesses();
    clearCache();
    clearCatalogCache();
    panelCache.clear();
    this.analyzer = undefined;
    this.parseResult = undefined;
    this.pendingMessages = [];
    this.dataReady = false;
    this.disposed = false;
    this.panel.webview.html = getDashboardHtml(this.panel.webview, this.extensionUri);
    void this.loadData();
  }

  private updateSidebarStats(): void {
    if (!this.parseResult) return;
    const harnesses = new Set<string>();
    for (const session of this.parseResult.sessions) {
      harnesses.add(session.harness);
    }
    saveSidebarStats({
      harnesses: Array.from(harnesses).sort(),
      savedAt: Date.now(),
    });
    DashboardSidebarProvider.instance?.refresh();
    SessionsTreeProvider.instance?.refresh();
  }

  /** Deep-link the dashboard webview onto a page (e.g. Session Chat with a
   *  session preselected). Queued until the webview has signalled dataReady,
   *  because messages posted before the script loads are dropped. */
  public navigateToPage(page: string, hint?: string): void {
    const message = { type: 'push', topic: 'navigate', page, hint } as const;
    if (this.dataReady && !this.disposed) {
      try { this.panel.webview.postMessage(message); } catch { /* disposed */ }
    } else {
      this.pendingNavigate = message;
    }
  }

  private flushPendingNavigate(): void {
    if (!this.pendingNavigate || this.disposed) return;
    try { this.panel.webview.postMessage(this.pendingNavigate); } catch { /* disposed */ }
    this.pendingNavigate = undefined;
  }

  private async loadData(): Promise<void> {
    this.loading = true;
    const t0 = Date.now();
    runtimeDebug('panel', 'loadData-start');
    const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

    // Throttle progress messages to the webview: at most once per 250ms.
    let lastProgressTime = 0;
    let pendingProgress: Parameters<typeof sendRaw>[0] | undefined;
    let progressFlushTimer: ReturnType<typeof setTimeout> | undefined;
    const sendRaw = (progress: { phase: number; detail?: string; pct: number; sessions?: number; linesOfCode?: number; toolCalls?: number; imagesAnalyzed?: number; filesEdited?: number; requests?: number; workspacePlan?: string[]; workspaceDone?: string }) => {
      if (this.disposed) return;
      try {
        this.panel.webview.postMessage({ type: 'progress', ...progress });
      } catch {
        // Webview may have been disposed between the flag check and the call.
      }
    };
    const sendProgress = (progress: Parameters<typeof sendRaw>[0]) => {
      if (this.disposed) {
        clearTimeout(progressFlushTimer);
        return;
      }
      const now = Date.now();
      // Always send immediately for phase changes, workspace grid updates, and the final "Ready".
      if (progress.phase !== pendingProgress?.phase || progress.workspacePlan || progress.workspaceDone || progress.pct >= 100) {
        clearTimeout(progressFlushTimer);
        sendRaw(progress);
        lastProgressTime = now;
        pendingProgress = progress;
        return;
      }
      pendingProgress = progress;
      if (now - lastProgressTime >= 250) {
        clearTimeout(progressFlushTimer);
        sendRaw(progress);
        lastProgressTime = now;
      } else if (!progressFlushTimer) {
        progressFlushTimer = setTimeout(() => {
          progressFlushTimer = undefined;
          if (pendingProgress && !this.disposed) {
            sendRaw(pendingProgress);
            lastProgressTime = Date.now();
          }
        }, 250 - (now - lastProgressTime));
      }
    };

    const safePost = (msg: Record<string, unknown>) => {
      if (this.disposed) return;
      try {
        this.panel.webview.postMessage(msg);
      } catch {
        // Webview disposed between check and call.
      }
    };

    try {
      if (panelCache.analyzerInstance && panelCache.result) {
        runtimeDebug('panel', 'loadData-cache-hit');
        this.parseResult = panelCache.result;
        this.analyzer = panelCache.analyzerInstance;
        this.updateSidebarStats();
        this.dataReady = true;
        safePost({ type: 'dataReady', currentWorkspace: vscode.workspace.name || '' });
        this.flushPendingNavigate();
        return;
      }

      sendProgress({ phase: 0, detail: 'Discovering log directories', pct: 0 });
      await flush();
      if (this.disposed) return;

      const dirs = findLogsDirs();
      const hasExternal = hasExternalHarnessSources();
      runtimeDebug('panel', 'logs-dirs-found', `count=${dirs.length} external=${hasExternal}`);
      // External harnesses (Claude Code, Codex, OpenCode) are collected by the
      // parse worker independently of `dirs`, so only abort when no source of
      // any kind is present. Otherwise a host with e.g. only Claude Code logs
      // (and no VS Code/Copilot directories) would never load.
      if (dirs.length === 0 && !hasExternal) {
        runtimeDebug('panel', 'loadData-no-dirs');
        if (!this.disposed) {
          try { this.panel.webview.html = getErrorHtml('No AI coding session logs found. Looked for VS Code, GitHub Copilot (CLI and Xcode), Claude Code, Codex, and OpenCode sessions.'); } catch { /* disposed */ }
        }
        return;
      }

      this.parseResult = await parseAllLogsViaWorker(dirs, progress => sendProgress(progress));
      if (this.disposed) return;
      runtimeDebug('panel', 'parse-complete', `sessions=${this.parseResult.sessions.length} workspaces=${this.parseResult.workspaces.size}`);
      const sessionCount = this.parseResult.sessions.length;

      sendProgress({ phase: 4, detail: 'Building analyzer', pct: 90, sessions: sessionCount });
      await flush();
      if (this.disposed) return;

      this.analyzer = new Analyzer(this.parseResult.sessions, this.parseResult.editLocIndex, this.parseResult.workspaces);
      runtimeDebug('panel', 'analyzer-built', `elapsedMs=${Date.now() - t0}`);

      sendProgress({ phase: 5, detail: 'Ready', pct: 100, sessions: sessionCount });
      await flush();
      if (this.disposed) return;

      panelCache.store(this.parseResult, this.analyzer);
      this.updateSidebarStats();

      // Mark data ready BEFORE notifying webview, so incoming RPC calls
      // are handled immediately instead of being queued behind warmUp().
      this.dataReady = true;

      safePost({ type: 'dataReady', currentWorkspace: vscode.workspace.name || '' });
      this.flushPendingNavigate();
      runtimeDebug('panel', 'data-ready-sent', `elapsedMs=${Date.now() - t0}`);

      try {
        await this.analyzer.warmUp();
      } catch (error) {
        runtimeDebug('panel', 'warmUp-failed', error);
      }
      runtimeDebug('panel', 'warmUp-done', `elapsedMs=${Date.now() - t0}`);
      if (this.disposed) return;

      for (const message of this.pendingMessages) {
        this.handleMessage(message);
      }
      this.pendingMessages = [];
    } catch (error: unknown) {
      runtimeDebug('panel', 'loadData-error', error);
      if (!this.disposed) {
        try { this.panel.webview.html = getErrorHtml(error instanceof Error ? error.message : 'Failed to load data'); } catch { /* disposed */ }
      }
    } finally {
      this.loading = false;
      this.loadCompletedAt = Date.now();
    }
  }

  /** Host-only methods that bypass the analyzer/data-readiness pipeline.
   *  Returns true when the message was consumed. */
  private handleHostOnlyMessage(msg: Extract<WebviewMessage, { type: 'request' }>): boolean {
    // Open external URLs from webview
    if (msg.method === 'openExternal') {
      const url = (msg.params as Record<string, unknown> | undefined)?.url;
      if (typeof url === 'string') {
        void vscode.env.openExternal(vscode.Uri.parse(url));
        postResponse(this.panel.webview, msg.id, { ok: true });
      }
      return true;
    }

    // Budget persistence — handled before data readiness check
    if (msg.method === 'saveModelBudgets' || msg.method === 'loadModelBudgets') {
      this.handleBudgetMessage(msg);
      return true;
    }

    // Claude-powered consent — globalState-backed, independent of parsed data.
    // `sessionChatConsent` is the pre-2.0 name; both read/write the unified key.
    if (msg.method === 'claudePoweredConsent' || msg.method === 'sessionChatConsent') {
      this.handleConsentMessage(msg);
      return true;
    }

    if (msg.method === 'understandFeatures') {
      postResponse(this.panel.webview, msg.id, readUnderstandFeatures());
      return true;
    }

    if (msg.method === 'openWorkspaceFile') {
      const params = (msg.params ?? {}) as Record<string, unknown>;
      void openWorkspaceFileBeside(
        typeof params.path === 'string' ? params.path : '',
        typeof params.line === 'number' ? params.line : undefined,
      ).then(result => { if (!this.disposed) try { postResponse(this.panel.webview, msg.id, result); } catch { /* disposed */ } });
      return true;
    }

    if (msg.method === 'saveTextFile') {
      const params = (msg.params ?? {}) as Record<string, unknown>;
      void saveTextFileViaDialog(
        typeof params.content === 'string' ? params.content : '',
        typeof params.defaultName === 'string' ? params.defaultName : 'export.md',
      ).then(result => { if (!this.disposed) try { postResponse(this.panel.webview, msg.id, result); } catch { /* disposed */ } });
      return true;
    }

    if (msg.method === 'reloadData') {
      postResponse(this.panel.webview, msg.id, { ok: true });
      this.reload(true);
      return true;
    }

    if (msg.method.startsWith('atlas')) {
      void this.atlas.handle(msg.method, (msg.params ?? {}) as Record<string, unknown>).then(
        result => { if (!this.disposed) try { postResponse(this.panel.webview, msg.id, result); } catch { /* disposed */ } },
        error => { if (!this.disposed) try { postResponse(this.panel.webview, msg.id, errorResult(error instanceof Error ? error.message : 'Atlas error')); } catch { /* disposed */ } },
      );
      return true;
    }

    return false;
  }

  private handleMessage(msg: unknown): void {
    if (this.disposed) return;
    if (!isRequestMessage(msg)) return;

    if (this.handleHostOnlyMessage(msg)) return;

    if (this.requestService.tryHandle(msg)) return;

    if (!this.dataReady || !this.analyzer || !this.parseResult) {
      this.pendingMessages.push(msg);
      return;
    }

    const handler = getRpcHandler(msg.method);
    if (!handler) {
      if (!this.disposed) {
        try { postResponse(this.panel.webview, msg.id, errorResult(`Unknown method: ${msg.method}`)); } catch { /* disposed */ }
      }
      return;
    }

    try {
      const result = handler(this.analyzer, this.parseResult, (msg.params ?? {}) as Record<string, unknown>);
      // Support async RPC handlers (e.g. getSessionDetail loads from disk)
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        (result as Promise<unknown>).then(
          (data) => {
            if (!this.disposed) {
              try { postResponse(this.panel.webview, msg.id, data); } catch { /* disposed */ }
            }
          },
          (error) => {
            if (!this.disposed) {
              try { postResponse(this.panel.webview, msg.id, errorResult(error instanceof Error ? error.message : 'Internal error')); } catch { /* disposed */ }
            }
          },
        );
      } else {
        if (!this.disposed) {
          try { postResponse(this.panel.webview, msg.id, result); } catch { /* disposed */ }
        }
      }
    } catch (error: unknown) {
      const data = errorResult(error instanceof Error ? error.message : 'Internal error');
      if (!this.disposed) {
        try { postResponse(this.panel.webview, msg.id, data); } catch { /* disposed */ }
      }
    }
  }

  private static readonly BUDGET_STATE_KEY = 'modelBudgets';

  private handleConsentMessage(msg: Extract<WebviewMessage, { type: 'request' }>): void {
    const ack = (msg.params as Record<string, unknown> | undefined)?.ack === true;
    if (ack) {
      this.globalState.update(CLAUDE_POWERED_CONSENT_KEY, true).then(
        () => { if (!this.disposed) try { postResponse(this.panel.webview, msg.id, { consented: true }); } catch { /* disposed */ } },
        () => { if (!this.disposed) try { postResponse(this.panel.webview, msg.id, errorResult('Failed to save consent')); } catch { /* disposed */ } },
      );
      return;
    }
    const consented = hasClaudePoweredConsent(this.globalState);
    if (!this.disposed) try { postResponse(this.panel.webview, msg.id, { consented }); } catch { /* disposed */ }
  }

  private handleBudgetMessage(msg: Extract<WebviewMessage, { type: 'request' }>): void {
    if (msg.method === 'saveModelBudgets') {
      const budgets = (msg.params as Record<string, unknown>)?.budgets;
      this.globalState.update(DashboardPanel.BUDGET_STATE_KEY, budgets).then(
        () => { if (!this.disposed) try { postResponse(this.panel.webview, msg.id, { ok: true }); } catch { /* disposed */ } },
        () => { if (!this.disposed) try { postResponse(this.panel.webview, msg.id, errorResult('Failed to save budgets')); } catch { /* disposed */ } },
      );
    } else {
      const budgets = this.globalState.get<Record<string, number>>(DashboardPanel.BUDGET_STATE_KEY, {});
      if (!this.disposed) try { postResponse(this.panel.webview, msg.id, budgets); } catch { /* disposed */ }
    }
  }

  private dispose(): void {
    runtimeDebug('panel', 'dispose');
    this.disposed = true;
    closeAllChatProcesses();
    this.atlas.dispose();
    setLiveChatPushSender(undefined);
    setClaudeConsentProvider(undefined);
    DashboardPanel.instance = undefined;
    this.panel.dispose();
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables.length = 0;
  }
}
