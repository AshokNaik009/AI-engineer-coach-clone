/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Atlas renderer HTML assembly — pure core, no VS Code dependency. Used by
 * `webview/atlas-panel.ts`; kept separate so the nonce injection, CSP and
 * L1 shim can be unit-tested against real Archify output. */

import * as path from 'path';

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

export function toRepoRelative(filePath: string, workspaceRoot: string): string {
  if (!path.isAbsolute(filePath)) return filePath.replaceAll('\\', '/');
  return path.relative(workspaceRoot, filePath).replaceAll('\\', '/');
}

/** Add the nonce to every <script> tag (data blocks included — harmless). */
export function injectNonce(html: string, nonce: string): string {
  return html.replaceAll(/<script\b(?![^>]*\bnonce=)([^>]*)>/gi, `<script nonce="${nonce}"$1>`);
}

export interface RendererHtmlOptions {
  cspSource: string;
  nonce: string;
  mapId: string;
  highlightPaths?: string[];
}

export function buildRendererHtml(archifyHtml: string, opts: RendererHtmlOptions): string {
  const { cspSource, nonce } = opts;
  const csp = [
    "default-src 'none'",
    `img-src ${cspSource} data: blob:`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `font-src ${cspSource} data:`,
    "connect-src 'none'",
  ].join('; ');
  const shim = `<script nonce="${nonce}">${L1_SHIM}</script>`;
  const boot = `<script nonce="${nonce}">window.__atlasInit=${JSON.stringify({ mapId: opts.mapId, highlightPaths: (opts.highlightPaths ?? []).map(p => p.replaceAll('\\', '/')) })};</script>`;

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

  function nodesFor(path) {
    if (!path) return [];
    var key = String(path).replace(/\\/g, '/').toLowerCase();
    var ids = pathToNodes[key];
    if (!ids || !ids.length) {
      // Absolute vs repo-relative: accept a suffix match on a path boundary.
      Object.keys(pathToNodes).some(function (k) {
        if (key.endsWith('/' + k) || k.endsWith('/' + key) || key === k) { ids = pathToNodes[k]; return true; }
        return false;
      });
    }
    return ids || [];
  }

  function toast(text) {
    var el = document.getElementById('atlas-shim-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'atlas-shim-toast';
      el.setAttribute('style', 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:99999;font:12px system-ui,sans-serif;padding:6px 12px;border-radius:6px;background:rgba(20,20,20,.9);color:#eee;box-shadow:0 2px 8px rgba(0,0,0,.4);pointer-events:none;transition:opacity .3s;');
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.style.opacity = '1';
    clearTimeout(el.__t);
    el.__t = setTimeout(function () { el.style.opacity = '0'; }, 3500);
  }

  var MARK_ATTR = 'data-atlas-marked';
  function clearMarks() {
    Array.prototype.forEach.call(document.querySelectorAll('[' + MARK_ATTR + ']'), function (n) {
      n.removeAttribute(MARK_ATTR);
      n.style.filter = '';
    });
  }

  /** Highlight one or many files: mark every owning node, select the first. */
  function highlight(paths) {
    var list = Array.isArray(paths) ? paths : [paths];
    clearMarks();
    var ids = [];
    var missed = [];
    list.forEach(function (p) {
      var found = nodesFor(p);
      if (!found.length) missed.push(p);
      found.forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); });
    });
    ids.forEach(function (id) {
      var node = document.querySelector('[data-node-id="' + id.replace(/"/g, '') + '"]');
      if (!node) return;
      node.setAttribute(MARK_ATTR, '');
      node.style.filter = 'drop-shadow(0 0 6px #e3b341) drop-shadow(0 0 2px #e3b341)';
    });
    if (!ids.length) {
      toast(list.length === 1 ? 'No node in this map cites ' + String(list[0]).split('/').pop() : 'No node in this map cites these files');
      return false;
    }
    var first = document.querySelector('[data-node-id="' + ids[0].replace(/"/g, '') + '"]');
    if (first) {
      try { first.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) { /* ignore */ }
      first.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }
    if (list.length > 1) toast(ids.length + ' node' + (ids.length === 1 ? '' : 's') + ' touched by this session' + (missed.length ? ' · ' + missed.length + ' file' + (missed.length === 1 ? '' : 's') + ' not on the map' : ''));
    return true;
  }

  window.addEventListener('message', function (ev) {
    var msg = ev.data || {};
    if (msg.type === 'atlas.highlight') highlight(msg.paths || msg.path);
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
    if (initData.highlightPaths && initData.highlightPaths.length) setTimeout(function () { highlight(initData.highlightPaths); }, 400);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 0); });
  else setTimeout(init, 0);
})();
`;

