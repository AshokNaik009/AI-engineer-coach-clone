/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import { describe, it, expect } from 'vitest';
import { buildRendererHtml, confineToWorkspace, injectNonce, toRepoRelative } from './atlas-html';

/** Minimal stand-in for Archify output: inline scripts, a JSON data block, its own CSP. */
const SAMPLE = `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'">
<title>t</title></head><body>
<script id="archify-source-evidence-data" type="application/json">{"verified":true,"repository":{},"nodes":{"a":[{"path":"src/x.ts","line":3}]}}</script>
<script>window.Archify = {};</script>
<script type="module">console.log(1)</script>
</body></html>`;

describe('injectNonce', () => {
  it('adds the nonce to every script tag and leaves existing nonces alone', () => {
    const out = injectNonce(SAMPLE, 'N1');
    const tags = out.match(/<script\b[^>]*>/g) ?? [];
    expect(tags).toHaveLength(3);
    expect(tags.every(t => t.includes('nonce="N1"'))).toBe(true);
    expect(injectNonce('<script nonce="a">x</script>', 'b')).toBe('<script nonce="a">x</script>');
  });
});

describe('buildRendererHtml', () => {
  it('replaces the shipped CSP with ours, keeps connect-src none, and prepends boot + shim', () => {
    const out = buildRendererHtml(SAMPLE, { cspSource: 'vscode-webview://x', nonce: 'N2', mapId: 'm1', highlightPaths: ['src\\x.ts'] });
    const csps = out.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/g) ?? [];
    expect(csps).toHaveLength(1);
    expect(csps[0]).toContain("script-src 'nonce-N2'");
    expect(csps[0]).toContain("connect-src 'none'");
    expect(csps[0]).toMatch(/script-src 'nonce-N2';/); // script-src never relaxes to unsafe-inline
    expect(out.indexOf('__atlasInit')).toBeLessThan(out.indexOf('window.Archify'));
    expect(out).toContain('"highlightPaths":["src/x.ts"]');
    expect(out).toContain("'atlas.open'");
    const tags = out.match(/<script\b[^>]*>/g) ?? [];
    expect(tags.filter(t => !t.includes('nonce="N2"'))).toEqual([]);
  });

  it('nonce-stamps a real Archify map when the spike output is available', () => {
    const spike = '/tmp/atlas-spike3/map.html';
    if (!fs.existsSync(spike)) return;
    const html = fs.readFileSync(spike, 'utf-8');
    const out = buildRendererHtml(html, { cspSource: 'vscode-webview://x', nonce: 'N3', mapId: 'm' });
    const tags = out.match(/<script\b[^>]*>/g) ?? [];
    expect(tags.length).toBeGreaterThanOrEqual(4);
    expect(tags.filter(t => !t.includes('nonce="N3"'))).toEqual([]);
    expect(out).toContain('archify-source-evidence-data');
  });
});

describe('confineToWorkspace', () => {
  it('resolves relative paths, accepts absolute paths inside the root, refuses escapes', () => {
    expect(confineToWorkspace('src/a.ts', '/repo')).toBe('/repo/src/a.ts');
    expect(confineToWorkspace('/repo/src/a.ts', '/repo')).toBe('/repo/src/a.ts');
    expect(confineToWorkspace('file:///repo/x.ts', '/repo')).toBe('/repo/x.ts');
    expect(confineToWorkspace('../etc/passwd', '/repo')).toBeNull();
    expect(confineToWorkspace('/etc/passwd', '/repo')).toBeNull();
    expect(confineToWorkspace('/repository-evil/x', '/repo')).toBeNull();
    expect(confineToWorkspace('', '/repo')).toBeNull();
  });
  it('toRepoRelative normalizes separators', () => {
    expect(toRepoRelative('/repo/src/a.ts', '/repo')).toBe('src/a.ts');
    expect(toRepoRelative('src\\a.ts', '/repo')).toBe('src/a.ts');
  });
});
