/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Atlas renderer — a dedicated WebviewPanel that hosts one Archify HTML
 * (spec §4.4). The dashboard's strict CSP cannot run Archify's inline
 * scripts, so this panel:
 *
 *   - injects the panel nonce into every <script> tag (with a nonce present
 *     browsers ignore 'unsafe-inline', so relaxing script-src would not help);
 *   - keeps connect-src 'none' — the spike found Archify output fully inline;
 *   - prepends the L1 shim: clicks on source references post
 *     { type: 'atlas.open', path, line } and the host opens the file beside
 *     the panel after confining the path to the workspace root.
 *
 * The HTML comes from the user's own Claude run over their own repo — the
 * same trust level as Session Chat tool execution (caveat §9.4). */

import * as fs from 'fs';
import * as vscode from 'vscode';
import type { AtlasMapMeta } from '../core/types/atlas-types';
import { runtimeDebug } from '../core/runtime-debug';
import { buildRendererHtml, confineToWorkspace, toRepoRelative } from '../core/atlas-html';
import { getNonce } from './panel-shared';

const VIEW_TYPE = 'aiEngineerCoach.atlasMap';


export class AtlasMapPanel {
  private static readonly open = new Map<string, AtlasMapPanel>();

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly meta: AtlasMapMeta,
    private readonly workspaceRoot: string,
    column: vscode.ViewColumn,
  ) {
    this.panel = vscode.window.createWebviewPanel(VIEW_TYPE, `Atlas: ${meta.title}`, column, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [],
    });
    this.panel.webview.onDidReceiveMessage((msg: unknown) => this.onMessage(msg), null, this.disposables);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  /** Open (or reveal) the renderer for a map. */
  static show(meta: AtlasMapMeta, workspaceRoot: string, highlightPath?: string): { ok: boolean; error?: string } {
    const existing = AtlasMapPanel.open.get(meta.id);
    if (existing) {
      existing.panel.reveal();
      if (highlightPath) existing.highlight(highlightPath);
      return { ok: true };
    }
    let html: string;
    try {
      html = fs.readFileSync(meta.htmlPath, 'utf-8');
    } catch (err) {
      return { ok: false, error: `Map file is missing: ${err instanceof Error ? err.message : String(err)}` };
    }
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    const instance = new AtlasMapPanel(meta, workspaceRoot, column);
    AtlasMapPanel.open.set(meta.id, instance);
    instance.panel.webview.html = buildRendererHtml(html, { cspSource: instance.panel.webview.cspSource, nonce: getNonce(), mapId: meta.id, highlightPath });
    runtimeDebug('atlas-panel', 'opened', `${meta.id} ${meta.htmlPath}`);
    return { ok: true };
  }

  static closeAll(): void {
    for (const p of AtlasMapPanel.open.values()) p.panel.dispose();
  }

  private highlight(filePath: string): void {
    void this.panel.webview.postMessage({ type: 'atlas.highlight', path: toRepoRelative(filePath, this.workspaceRoot) });
  }

  private onMessage(msg: unknown): void {
    if (!isRecord(msg)) return;
    if (msg.type === 'atlas.sources') {
      runtimeDebug('atlas-panel', 'sources-detected', String(msg.count));
      return;
    }
    if (msg.type !== 'atlas.open') return;
    void this.openSource(typeof msg.path === 'string' ? msg.path : '', typeof msg.line === 'number' ? msg.line : undefined);
  }

  /** Resolve against the workspace root; refuse anything escaping it (§4.4 step 3). */
  private async openSource(rawPath: string, line?: number): Promise<void> {
    const resolved = confineToWorkspace(rawPath, this.workspaceRoot);
    if (!resolved) {
      void vscode.window.showWarningMessage(`Atlas: refused to open a path outside the workspace (${rawPath}).`);
      return;
    }
    if (!fs.existsSync(resolved)) {
      void vscode.window.showWarningMessage(`Atlas: ${rawPath} no longer exists at the mapped revision${this.meta.headSha ? ` (${this.meta.headSha.slice(0, 7)})` : ''}.`);
      return;
    }
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(resolved));
      const existing = vscode.window.visibleTextEditors.find(ed => ed.document.uri.toString() === doc.uri.toString());
      const editor = await vscode.window.showTextDocument(doc, { viewColumn: existing?.viewColumn ?? vscode.ViewColumn.Beside, preview: true });
      if (line && line > 0) {
        const pos = new vscode.Position(Math.min(line - 1, Math.max(0, doc.lineCount - 1)), 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
      }
    } catch (err) {
      void vscode.window.showWarningMessage(`Atlas: could not open ${rawPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private dispose(): void {
    AtlasMapPanel.open.delete(this.meta.id);
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
