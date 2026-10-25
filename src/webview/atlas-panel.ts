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
import * as path from 'path';
import * as vscode from 'vscode';
import type { AtlasMapMeta } from '../core/types/atlas-types';
import { runtimeDebug } from '../core/runtime-debug';
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
    instance.panel.webview.html = buildRendererHtml(html, instance.panel.webview, meta, highlightPath);
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
      const editor = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: true });
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

/* ================================================================== */
/*  HTML assembly                                                     */
/* ================================================================== */

export function confineToWorkspace(rawPath: string, workspaceRoot: string): string | null {
  if (!rawPath || rawPath.split(/[\\/]/).includes('..')) return null;
  const cleaned = rawPath.replace(/^file:\/\//, '');
  const abs = path.isAbsolute(cleaned) ? path.normalize(cleaned) : path.join(workspaceRoot, cleaned);
  const rel = path.relative(path.resolve(workspaceRoot), path.resolve(abs));
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return abs;
}

function toRepoRelative(filePath: string, workspaceRoot: string): string {
  if (!path.isAbsolute(filePath)) return filePath.replaceAll('\\', '/');
  return path.relative(workspaceRoot, filePath).replaceAll('\\', '/');
}

/** Add the nonce to every <script> tag (data blocks included — harmless). */
export function injectNonce(html: string, nonce: string): string {
  return html.replaceAll(/<script\b(?![^>]*\bnonce=)([^>]*)>/gi, `<script nonce="${nonce}"$1>`);
}

export function buildRendererHtml(archifyHtml: string, webview: vscode.Webview, meta: AtlasMapMeta, highlightPath?: string): string {
  const nonce = getNonce();
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data: blob:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `font-src ${webview.cspSource} data:`,
    "connect-src 'none'",
  ].join('; ');
  const shim = `<script nonce="${nonce}">${L1_SHIM}</script>`;
  const boot = `<script nonce="${nonce}">window.__atlasInit=${JSON.stringify({ mapId: meta.id, highlightPath: highlightPath ? highlightPath.replaceAll('\\', '/') : null })};</script>`;

  let html = injectNonce(archifyHtml, nonce);
  // Strip any CSP Archify ships so ours is the only one, then add ours + the shim at the head start.
  html = html.replaceAll(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '');
  const headOpen = html.match(/<head\b[^>]*>/i);
  const injection = `<meta http-equiv="Content-Security-Policy" content="${csp}">${boot}${shim}`;
  if (headOpen && headOpen.index !== undefined) {
    const at = headOpen.index + headOpen[0].length;
    html = html.slice(0, at) + injection + html.slice(at);
  } else {
    html = injection + html;
  }
  return html;
}

/* L1 shim (spec §4.4 + spike §3). Strategy order, decided by the spike's DOM
 * findings:
 *   1. `.semantic-passport-source` rows the Archify viewer renders when a node
 *      is selected (`<small>` = repo-relative path, `<code>` = "L12–34");
 *   2. `a[href^="file://"]`;
 *   3. `[data-path]` / `[data-file]` (+ `[data-line]`);
 *   4. anchor text matching `path.ext:line`.
 * Also reads the `archify-source-evidence-data` JSON to count sources (so the
 * dashboard can say "Source links not detected") and to support L2 highlight:
 * path → node ids → click the `[data-node-id]` element. */
const L1_SHIM = String.raw`
(function () {
  var vscode = acquireVsCodeApi();
  var EXT_RE = /^([\w./@-]+\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|rb|php|cs|swift|m|mm|c|cc|cpp|h|hpp|css|scss|html|json|ya?ml|toml|md|sh|sql|vue|svelte)):(\d+)/i;
  var evidence = null;
  var pathToNodes = {};

  function readEvidence() {
    var el = document.getElementById('archify-source-evidence-data');
    if (!el) return;
    try { evidence = JSON.parse(el.textContent || 'null'); } catch (e) { evidence = null; }
    if (!evidence || !evidence.nodes) return;
    Object.keys(evidence.nodes).forEach(function (nodeId) {
      (evidence.nodes[nodeId] || []).forEach(function (src) {
        if (!src || !src.path) return;
        var key = String(src.path).replace(/\\/g, '/').toLowerCase();
        (pathToNodes[key] = pathToNodes[key] || []).push(nodeId);
      });
    });
  }

  function open(path, line) {
    if (!path) return;
    vscode.postMessage({ type: 'atlas.open', path: String(path), line: line ? Number(line) : undefined });
  }

  function fromPassport(el) {
    var row = el.closest('.semantic-passport-source');
    if (!row) return null;
    var small = row.querySelector('small');
    var code = row.querySelector('code');
    var m = code && /L(\d+)/.exec(code.textContent || '');
    var p = small && small.textContent;
    return p ? { path: p.trim(), line: m ? m[1] : undefined } : null;
  }
  function fromFileHref(el) {
    var a = el.closest('a[href^="file://"]');
    if (!a) return null;
    var href = a.getAttribute('href') || '';
    var hash = /#L?(\d+)/.exec(href);
    return { path: decodeURIComponent(href.replace(/^file:\/\//, '').replace(/#.*$/, '')), line: hash ? hash[1] : undefined };
  }
  function fromDataAttrs(el) {
    var node = el.closest('[data-path],[data-file]');
    if (!node) return null;
    return { path: node.getAttribute('data-path') || node.getAttribute('data-file'), line: node.getAttribute('data-line') || undefined };
  }
  function fromText(el) {
    var a = el.closest('a,code,span');
    if (!a) return null;
    var m = EXT_RE.exec((a.textContent || '').trim());
    return m ? { path: m[1], line: m[2] } : null;
  }

  document.addEventListener('click', function (ev) {
    var el = ev.target;
    if (!(el instanceof Element)) return;
    var hit = fromPassport(el) || fromFileHref(el) || fromDataAttrs(el) || fromText(el);
    if (!hit) return;
    ev.preventDefault();
    ev.stopPropagation();
    open(hit.path, hit.line);
  }, true);

  function highlight(path) {
    if (!path) return false;
    var key = String(path).replace(/\\/g, '/').toLowerCase();
    var ids = pathToNodes[key];
    if (!ids || !ids.length) {
      // Try suffix match (absolute vs repo-relative).
      Object.keys(pathToNodes).some(function (k) { if (key.endsWith(k) || k.endsWith(key)) { ids = pathToNodes[k]; return true; } return false; });
    }
    if (!ids || !ids.length) return false;
    var node = document.querySelector('[data-node-id="' + ids[0].replace(/"/g, '') + '"]');
    if (!node) return false;
    try { node.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) { /* ignore */ }
    node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return true;
  }

  window.addEventListener('message', function (ev) {
    var msg = ev.data || {};
    if (msg.type === 'atlas.highlight') highlight(msg.path);
  });

  function init() {
    readEvidence();
    var count = 0;
    Object.keys(pathToNodes).forEach(function (k) { count += pathToNodes[k].length; });
    if (!count) count = document.querySelectorAll('a[href^="file://"],[data-path],[data-file]').length;
    vscode.postMessage({ type: 'atlas.sources', count: count });
    if (!count) {
      var note = document.createElement('div');
      note.textContent = 'Source links not detected in this map';
      note.setAttribute('style', 'position:fixed;left:8px;bottom:8px;z-index:99999;font:11px system-ui,sans-serif;padding:4px 8px;border-radius:4px;background:rgba(0,0,0,.6);color:#ddd;pointer-events:none;');
      document.body.appendChild(note);
    }
    var initData = window.__atlasInit || {};
    if (initData.highlightPath) setTimeout(function () { highlight(initData.highlightPath); }, 400);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 0); });
  else setTimeout(init, 0);
})();
`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
