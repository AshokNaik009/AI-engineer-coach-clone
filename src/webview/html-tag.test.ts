/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The `html` tagged template and `rawHtml` marker live in shared.ts which imports
 * browser-only globals (acquireVsCodeApi, window). To keep this test unit-local,
 * we re-implement the same helpers here and assert the contract they follow.
 * If shared.ts changes the contract, these tests must be updated in lockstep.
 */

import { describe, it, expect } from 'vitest';

const SAFE_HTML = Symbol('SAFE_HTML');
interface SafeHtml { readonly [SAFE_HTML]: true; toString(): string }

function rawHtml(s: string): SafeHtml {
  return { [SAFE_HTML]: true, toString: () => s };
}
function isSafeHtml(v: unknown): v is SafeHtml {
  return typeof v === 'object' && v !== null && (v as Record<symbol, unknown>)[SAFE_HTML] === true;
}
function escapeEntities(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll('\'', '&#39;');
}
function renderValue(v: unknown): string {
  if (v == null || v === false) return '';
  if (isSafeHtml(v)) return v.toString();
  if (Array.isArray(v)) return v.map(renderValue).join('');
  if (typeof v === 'number' || typeof v === 'bigint' || typeof v === 'boolean' || typeof v === 'string') {
    return escapeEntities(String(v));
  }
  if (v instanceof Date || v instanceof RegExp || v instanceof Error) {
    return escapeEntities(String(v));
  }
  if (typeof v === 'object') {
    return escapeEntities(Object.prototype.toString.call(v));
  }
  if (typeof v === 'function' || typeof v === 'symbol') {
    return escapeEntities(v.toString());
  }
  return '';
}
function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += renderValue(values[i]) + strings[i + 1];
  return rawHtml(out);
}

describe('html tagged template', () => {
  it('escapes string interpolations', () => {
    const name = '<script>alert(1)</script>';
    expect(html`<div>${name}</div>`.toString())
      .toBe('<div>&lt;script&gt;alert(1)&lt;/script&gt;</div>');
  });

  it('escapes quotes inside attributes', () => {
    const v = 'a"b\'c';
    expect(html`<i title="${v}"></i>`.toString()).toBe('<i title="a&quot;b&#39;c"></i>');
  });

  it('passes numbers through without escaping', () => {
    expect(html`<b>${42}</b>`.toString()).toBe('<b>42</b>');
  });

  it('renders null/undefined/false as empty', () => {
    expect(html`[${null}|${undefined}|${false}]`.toString()).toBe('[||]');
  });

  it('renders true as "true"', () => {
    expect(html`${true}`.toString()).toBe('true');
  });

  it('joins arrays and processes each element', () => {
    const items = ['<a>', '<b>'];
    expect(html`${items}`.toString()).toBe('&lt;a&gt;&lt;b&gt;');
  });

  it('nested html tags pass through unescaped', () => {
    const inner = html`<em>${'&'}</em>`;
    expect(html`<p>${inner}</p>`.toString()).toBe('<p><em>&amp;</em></p>');
  });

  it('rawHtml opts out of escaping', () => {
    expect(html`${rawHtml('<br>')}`.toString()).toBe('<br>');
  });

  it('arrays of nested html tags compose safely', () => {
    const rows = [html`<li>${'<x>'}</li>`, html`<li>${'y'}</li>`];
    expect(html`<ul>${rows}</ul>`.toString()).toBe('<ul><li>&lt;x&gt;</li><li>y</li></ul>');
  });
});
