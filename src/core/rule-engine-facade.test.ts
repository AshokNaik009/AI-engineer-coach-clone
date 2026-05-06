/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { RuleEngine } from './rule-engine-facade';

describe('RuleEngine facade', () => {
  it('init() loads the built-in rule set', () => {
    RuleEngine.init();
    const rules = RuleEngine.getRules();
    expect(rules.length).toBeGreaterThanOrEqual(34);
  });

  it('getRule() returns a known built-in rule', () => {
    RuleEngine.init();
    const rule = RuleEngine.getRule('lazy-prompting');
    expect(rule).toBeDefined();
    expect(rule?.name).toBeTruthy();
  });

  it('runAll() on empty data returns an empty array', () => {
    RuleEngine.init();
    expect(RuleEngine.runAll([], [], false)).toEqual([]);
  });

  it('paths.personal() returns an absolute path', () => {
    const p = RuleEngine.paths.personal();
    expect(p.length).toBeGreaterThan(0);
    expect(p.endsWith(path.join('.ai-engineer-coach', 'rules'))).toBe(true);
  });

  it('testMarkdown() evaluates a tiny rule without throwing', () => {
    const md = [
      '---',
      'id: test-rule-smoke',
      'name: Smoke',
      'group: prompt-quality',
      'severity: low',
      'scope: requests',
      'version: 1',
      'tags: []',
      '---',
      '',
      '# Description',
      'test',
      '',
      '# When Triggered',
      '{{count}}',
      '',
      '# How to Improve',
      'none',
      '',
      '# Detection Logic',
      '```detect',
      'scan: requests',
      'match: messageLength > 0',
      'aggregate: count',
      'check: count > 0',
      '```',
    ].join('\n');

    const result = RuleEngine.testMarkdown(md, [], []);
    expect(result).not.toBeNull();
    expect(typeof result!.triggered).toBe('boolean');
  });

  it('testMarkdown() returns null for unparseable markdown', () => {
    const result = RuleEngine.testMarkdown('not a rule', [], []);
    expect(result).toBeNull();
  });

  it('runEmittersOnly() returns a map keyed by ruleId', () => {
    RuleEngine.init();
    const emissions = RuleEngine.runEmittersOnly([], [], false);
    expect(emissions).toBeInstanceOf(Map);
  });

  it('getLayerInfo() lists the built-in layer', () => {
    RuleEngine.init();
    const layers = RuleEngine.getLayerInfo();
    expect(Array.isArray(layers)).toBe(true);
    expect(layers.some(l => l.layer === 'built-in')).toBe(true);
  });

  it('updateThresholds() is a no-op for an unknown rule (no throw)', () => {
    expect(() => RuleEngine.updateThresholds('does-not-exist', { foo: 1 })).not.toThrow();
  });

  it('paths.project(workspaceRoot) contains the workspace path', () => {
    const wsRoot = path.resolve('/tmp/some-ws');
    const p = RuleEngine.paths.project(wsRoot);
    expect(p).toContain(wsRoot);
  });
});
