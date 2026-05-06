/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashContent, type TrustGate } from './rule-trust';

const mockFs = vi.hoisted(() => ({
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
  promises: {
    readdir: vi.fn(),
    readFile: vi.fn(),
  },
}));

const mockOs = vi.hoisted(() => ({
  homedir: vi.fn(),
}));

const mockRuleEngine = vi.hoisted(() => ({
  registerBuiltinRuleSource: vi.fn(),
  registerPersonalRuleSource: vi.fn(),
  registerProjectRuleSource: vi.fn(),
  clearLayerRules: vi.fn(),
  loadBuiltinRules: vi.fn(),
}));

const mockMetricEngine = vi.hoisted(() => ({
  parseMetric: vi.fn(),
  registerMetric: vi.fn(),
  clearMetrics: vi.fn(),
}));

const mockLog = vi.hoisted(() => ({
  warnCore: vi.fn(),
}));

vi.mock('fs', () => ({
  readdirSync: mockFs.readdirSync,
  readFileSync: mockFs.readFileSync,
  promises: mockFs.promises,
}));

vi.mock('os', () => ({
  homedir: mockOs.homedir,
}));

vi.mock('./rule-engine', () => ({
  registerBuiltinRuleSource: mockRuleEngine.registerBuiltinRuleSource,
  registerPersonalRuleSource: mockRuleEngine.registerPersonalRuleSource,
  registerProjectRuleSource: mockRuleEngine.registerProjectRuleSource,
  clearLayerRules: mockRuleEngine.clearLayerRules,
  loadBuiltinRules: mockRuleEngine.loadBuiltinRules,
}));

vi.mock('./metric-engine', () => ({
  parseMetric: mockMetricEngine.parseMetric,
  registerMetric: mockMetricEngine.registerMetric,
  clearMetrics: mockMetricEngine.clearMetrics,
}));

vi.mock('./log', () => ({
  warnCore: mockLog.warnCore,
}));

const CORE_DIR = path.dirname(fileURLToPath(import.meta.url));
const HOME_DIR = '/mock-home';
const WORKSPACE_ROOT = '/workspace';
const BUILTIN_RULES_DIR = path.join(CORE_DIR, 'rules');
const FALLBACK_RULES_DIR = path.join(CORE_DIR, '..', 'src', 'core', 'rules');
const PERSONAL_RULES_DIR = path.join(HOME_DIR, '.ai-engineer-coach', 'rules');
const PROJECT_RULES_DIR = path.join(WORKSPACE_ROOT, '.ai-engineer-coach', 'rules');
const BUILTIN_METRICS_DIR = path.join(CORE_DIR, 'metrics');
const FALLBACK_METRICS_DIR = path.join(CORE_DIR, '..', 'src', 'core', 'metrics');
const PERSONAL_METRICS_DIR = path.join(HOME_DIR, '.ai-engineer-coach', 'metrics');
const PROJECT_METRICS_DIR = path.join(WORKSPACE_ROOT, '.ai-engineer-coach', 'metrics');

const VALID_RULE_MARKDOWN = `---
id: test-rule
name: Test Rule  
severity: medium
group: prompt-quality
scope: requests
---

# Filter
messageLength < 10

# Trigger
ratio > 0.3

# Description
{{count}} short prompts found.

# Suggestion
Write longer prompts.
`;

function makeMetricDefinition(id = 'metric-1') {
  return {
    id,
    name: `Metric ${id}`,
    scope: 'requests' as const,
    version: 1,
    tags: [] as string[],
    filterExpr: '',
    aggregationExpr: 'ratio',
    exampleTemplate: '',
    rawSource: '',
    source: 'built-in' as const,
    sourceFilePath: '',
  };
}

function mockDirectories(entries: Record<string, string[] | Error>): void {
  mockFs.readdirSync.mockImplementation((dir: string) => {
    const entry = entries[dir];
    if (entry instanceof Error || entry === undefined) {
      throw entry ?? new Error(`ENOENT: ${dir}`);
    }
    return entry;
  });
}

function mockFiles(entries: Record<string, string | Error>): void {
  mockFs.readFileSync.mockImplementation((filePath: string) => {
    const entry = entries[filePath];
    if (entry instanceof Error || entry === undefined) {
      throw entry ?? new Error(`ENOENT: ${filePath}`);
    }
    return entry;
  });
}

type MockTrustGate = TrustGate & {
  isAllowedMock: ReturnType<typeof vi.fn>;
  onBlockedMock: ReturnType<typeof vi.fn>;
};

function makeTrustGate(isAllowed: TrustGate['isAllowed']): MockTrustGate {
  const isAllowedMock = vi.fn(isAllowed);
  const onBlockedMock = vi.fn();
  return {
    isAllowed: isAllowedMock,
    onBlocked: onBlockedMock,
    isAllowedMock,
    onBlockedMock,
  };
}

async function loadRuleLoader() {
  return import('./rule-loader');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockOs.homedir.mockReturnValue(HOME_DIR);
  mockRuleEngine.loadBuiltinRules.mockReturnValue([]);
  mockMetricEngine.parseMetric.mockImplementation((markdown: string) => {
    if (markdown.includes('metric-2')) return makeMetricDefinition('metric-2');
    if (markdown.includes('metric-3')) return makeMetricDefinition('metric-3');
    return makeMetricDefinition('metric-1');
  });
  mockDirectories({});
  mockFiles({});
});

describe('rule-loader', () => {
  it('exports the expected rules directory constant', async () => {
    const loader = await loadRuleLoader();
    expect(loader.RULES_DIR_NAME).toBe('.ai-engineer-coach/rules');
  });

  it('getPersonalRulesDir returns the homedir-based rules path', async () => {
    const loader = await loadRuleLoader();

    expect(loader.getPersonalRulesDir()).toBe(PERSONAL_RULES_DIR);
    expect(mockOs.homedir).toHaveBeenCalled();
  });

  it('getProjectRulesDir returns the workspace rules path', async () => {
    const loader = await loadRuleLoader();

    expect(loader.getProjectRulesDir(WORKSPACE_ROOT)).toBe(PROJECT_RULES_DIR);
  });

  it('registerAllBuiltinRules loads markdown files from the built-in directory', async () => {
    mockDirectories({
      [BUILTIN_RULES_DIR]: ['alpha.md', 'beta.md'],
    });
    mockFiles({
      [path.join(BUILTIN_RULES_DIR, 'alpha.md')]: VALID_RULE_MARKDOWN,
      [path.join(BUILTIN_RULES_DIR, 'beta.md')]: VALID_RULE_MARKDOWN.replace('test-rule', 'beta-rule'),
    });
    const loader = await loadRuleLoader();

    loader.registerAllBuiltinRules();

    expect(mockRuleEngine.registerBuiltinRuleSource).toHaveBeenCalledTimes(2);
    expect(mockRuleEngine.registerBuiltinRuleSource).toHaveBeenCalledWith('alpha', VALID_RULE_MARKDOWN);
    expect(mockRuleEngine.registerBuiltinRuleSource).toHaveBeenCalledWith(
      'beta',
      VALID_RULE_MARKDOWN.replace('test-rule', 'beta-rule'),
    );
  });

  it('registerAllBuiltinRules skips non-markdown files', async () => {
    mockDirectories({
      [BUILTIN_RULES_DIR]: ['alpha.md', 'notes.txt', 'nested.json'],
    });
    mockFiles({
      [path.join(BUILTIN_RULES_DIR, 'alpha.md')]: VALID_RULE_MARKDOWN,
    });
    const loader = await loadRuleLoader();

    loader.registerAllBuiltinRules();

    expect(mockRuleEngine.registerBuiltinRuleSource).toHaveBeenCalledTimes(1);
    expect(mockFs.readFileSync).not.toHaveBeenCalledWith(path.join(BUILTIN_RULES_DIR, 'notes.txt'), 'utf-8');
  });

  it('registerAllBuiltinRules falls back to the source rules directory when needed', async () => {
    mockDirectories({
      [BUILTIN_RULES_DIR]: new Error('dist missing'),
      [FALLBACK_RULES_DIR]: ['fallback.md'],
    });
    mockFiles({
      [path.join(FALLBACK_RULES_DIR, 'fallback.md')]: VALID_RULE_MARKDOWN,
    });
    const loader = await loadRuleLoader();

    loader.registerAllBuiltinRules();

    expect(mockFs.readdirSync).toHaveBeenCalledWith(BUILTIN_RULES_DIR);
    expect(mockFs.readdirSync).toHaveBeenCalledWith(FALLBACK_RULES_DIR);
    expect(mockRuleEngine.registerBuiltinRuleSource).toHaveBeenCalledWith('fallback', VALID_RULE_MARKDOWN);
  });

  it('registerAllBuiltinRules warns when no built-in rules directory can be found', async () => {
    mockDirectories({
      [BUILTIN_RULES_DIR]: new Error('dist missing'),
      [FALLBACK_RULES_DIR]: new Error('src missing'),
    });
    const loader = await loadRuleLoader();

    loader.registerAllBuiltinRules();

    expect(mockRuleEngine.registerBuiltinRuleSource).not.toHaveBeenCalled();
    expect(mockLog.warnCore).toHaveBeenCalledWith('RuleLoader', 'Could not find rules directory');
  });

  it('registerAllBuiltinRules only loads built-in rules once', async () => {
    mockDirectories({
      [BUILTIN_RULES_DIR]: ['alpha.md'],
    });
    mockFiles({
      [path.join(BUILTIN_RULES_DIR, 'alpha.md')]: VALID_RULE_MARKDOWN,
    });
    const loader = await loadRuleLoader();

    loader.registerAllBuiltinRules();
    loader.registerAllBuiltinRules();

    expect(mockFs.readdirSync).toHaveBeenCalledTimes(1);
    expect(mockRuleEngine.registerBuiltinRuleSource).toHaveBeenCalledTimes(1);
  });

  it('loadPersonalRules clears the personal layer and returns 0 when the directory is missing', async () => {
    const loader = await loadRuleLoader();

    expect(loader.loadPersonalRules()).toBe(0);

    expect(mockRuleEngine.clearLayerRules).toHaveBeenCalledWith('personal');
    expect(mockRuleEngine.registerPersonalRuleSource).not.toHaveBeenCalled();
  });

  it('loadPersonalRules loads markdown files from the personal directory', async () => {
    mockDirectories({
      [PERSONAL_RULES_DIR]: ['alpha.md', 'beta.md'],
    });
    mockFiles({
      [path.join(PERSONAL_RULES_DIR, 'alpha.md')]: VALID_RULE_MARKDOWN,
      [path.join(PERSONAL_RULES_DIR, 'beta.md')]: VALID_RULE_MARKDOWN.replace('test-rule', 'beta-rule'),
    });
    const loader = await loadRuleLoader();

    const count = loader.loadPersonalRules();

    expect(count).toBe(2);
    expect(mockRuleEngine.registerPersonalRuleSource).toHaveBeenCalledWith(
      'alpha',
      VALID_RULE_MARKDOWN,
      path.join(PERSONAL_RULES_DIR, 'alpha.md'),
    );
    expect(mockRuleEngine.registerPersonalRuleSource).toHaveBeenCalledWith(
      'beta',
      VALID_RULE_MARKDOWN.replace('test-rule', 'beta-rule'),
      path.join(PERSONAL_RULES_DIR, 'beta.md'),
    );
  });

  it('loadPersonalRules skips non-markdown files', async () => {
    mockDirectories({
      [PERSONAL_RULES_DIR]: ['alpha.md', 'notes.txt', 'beta.yaml'],
    });
    mockFiles({
      [path.join(PERSONAL_RULES_DIR, 'alpha.md')]: VALID_RULE_MARKDOWN,
    });
    const loader = await loadRuleLoader();

    const count = loader.loadPersonalRules();

    expect(count).toBe(1);
    expect(mockFs.readFileSync).not.toHaveBeenCalledWith(path.join(PERSONAL_RULES_DIR, 'notes.txt'), 'utf-8');
  });

  it('loadPersonalRules keeps going when a markdown file cannot be read', async () => {
    mockDirectories({
      [PERSONAL_RULES_DIR]: ['alpha.md', 'broken.md'],
    });
    mockFiles({
      [path.join(PERSONAL_RULES_DIR, 'alpha.md')]: VALID_RULE_MARKDOWN,
      [path.join(PERSONAL_RULES_DIR, 'broken.md')]: new Error('read failed'),
    });
    const loader = await loadRuleLoader();

    const count = loader.loadPersonalRules();

    expect(count).toBe(1);
    expect(mockRuleEngine.registerPersonalRuleSource).toHaveBeenCalledTimes(1);
    expect(mockLog.warnCore).toHaveBeenCalledWith(
      'RuleLoader',
      `Failed to read ${path.join(PERSONAL_RULES_DIR, 'broken.md')}`,
    );
  });

  it('loadPersonalRules skips rejected files and reports the blocked rule hash', async () => {
    const blockedPath = path.join(PERSONAL_RULES_DIR, 'blocked.md');
    const allowedPath = path.join(PERSONAL_RULES_DIR, 'allowed.md');
    const gate = makeTrustGate(filePath => filePath !== blockedPath);
    mockDirectories({
      [PERSONAL_RULES_DIR]: ['blocked.md', 'allowed.md'],
    });
    mockFiles({
      [blockedPath]: VALID_RULE_MARKDOWN,
      [allowedPath]: VALID_RULE_MARKDOWN.replace('test-rule', 'allowed-rule'),
    });
    const loader = await loadRuleLoader();

    const count = loader.loadPersonalRules(gate);

    expect(count).toBe(1);
    expect(gate.isAllowedMock).toHaveBeenCalledWith(blockedPath, VALID_RULE_MARKDOWN);
    expect(mockRuleEngine.registerPersonalRuleSource).toHaveBeenCalledTimes(1);
    expect(gate.onBlockedMock).toHaveBeenCalledWith({
      filePath: blockedPath,
      layer: 'personal',
      kind: 'rule',
      hash: hashContent(VALID_RULE_MARKDOWN),
      content: VALID_RULE_MARKDOWN,
    });
  });

  it('loadPersonalRules uses the default trust gate when none is passed', async () => {
    const blockedPath = path.join(PERSONAL_RULES_DIR, 'blocked.md');
    const gate = makeTrustGate(() => false);
    mockDirectories({
      [PERSONAL_RULES_DIR]: ['blocked.md'],
    });
    mockFiles({
      [blockedPath]: VALID_RULE_MARKDOWN,
    });
    const loader = await loadRuleLoader();
    loader.setDefaultTrustGate(gate);

    const count = loader.loadPersonalRules();

    expect(count).toBe(0);
    expect(gate.isAllowedMock).toHaveBeenCalledWith(blockedPath, VALID_RULE_MARKDOWN);
    expect(gate.onBlockedMock).toHaveBeenCalledTimes(1);
  });

  it('loadPersonalRules prefers an explicit trust gate over the default gate', async () => {
    const filePath = path.join(PERSONAL_RULES_DIR, 'alpha.md');
    const defaultGate = makeTrustGate(() => false);
    const explicitGate = makeTrustGate(() => true);
    mockDirectories({
      [PERSONAL_RULES_DIR]: ['alpha.md'],
    });
    mockFiles({
      [filePath]: VALID_RULE_MARKDOWN,
    });
    const loader = await loadRuleLoader();
    loader.setDefaultTrustGate(defaultGate);

    const count = loader.loadPersonalRules(explicitGate);

    expect(count).toBe(1);
    expect(explicitGate.isAllowedMock).toHaveBeenCalledWith(filePath, VALID_RULE_MARKDOWN);
    expect(defaultGate.isAllowedMock).not.toHaveBeenCalled();
  });

  it('loadProjectRules clears the project layer and returns 0 when the directory is missing', async () => {
    const loader = await loadRuleLoader();

    expect(loader.loadProjectRules(WORKSPACE_ROOT)).toBe(0);

    expect(mockRuleEngine.clearLayerRules).toHaveBeenCalledWith('project');
    expect(mockRuleEngine.registerProjectRuleSource).not.toHaveBeenCalled();
  });

  it('loadProjectRules loads markdown files from the project rules directory', async () => {
    mockDirectories({
      [PROJECT_RULES_DIR]: ['alpha.md', 'beta.md'],
    });
    mockFiles({
      [path.join(PROJECT_RULES_DIR, 'alpha.md')]: VALID_RULE_MARKDOWN,
      [path.join(PROJECT_RULES_DIR, 'beta.md')]: VALID_RULE_MARKDOWN.replace('test-rule', 'beta-rule'),
    });
    const loader = await loadRuleLoader();

    const count = loader.loadProjectRules(WORKSPACE_ROOT);

    expect(count).toBe(2);
    expect(mockRuleEngine.registerProjectRuleSource).toHaveBeenCalledWith(
      'alpha',
      VALID_RULE_MARKDOWN,
      path.join(PROJECT_RULES_DIR, 'alpha.md'),
    );
    expect(mockRuleEngine.registerProjectRuleSource).toHaveBeenCalledWith(
      'beta',
      VALID_RULE_MARKDOWN.replace('test-rule', 'beta-rule'),
      path.join(PROJECT_RULES_DIR, 'beta.md'),
    );
  });

  it('loadProjectRules skips rejected files and reports the project layer', async () => {
    const blockedPath = path.join(PROJECT_RULES_DIR, 'blocked.md');
    const gate = makeTrustGate(() => false);
    mockDirectories({
      [PROJECT_RULES_DIR]: ['blocked.md'],
    });
    mockFiles({
      [blockedPath]: VALID_RULE_MARKDOWN,
    });
    const loader = await loadRuleLoader();

    const count = loader.loadProjectRules(WORKSPACE_ROOT, gate);

    expect(count).toBe(0);
    expect(mockRuleEngine.registerProjectRuleSource).not.toHaveBeenCalled();
    expect(gate.onBlockedMock).toHaveBeenCalledWith({
      filePath: blockedPath,
      layer: 'project',
      kind: 'rule',
      hash: hashContent(VALID_RULE_MARKDOWN),
      content: VALID_RULE_MARKDOWN,
    });
  });

  it('loadProjectRules keeps going when a project rule cannot be read', async () => {
    mockDirectories({
      [PROJECT_RULES_DIR]: ['alpha.md', 'broken.md'],
    });
    mockFiles({
      [path.join(PROJECT_RULES_DIR, 'alpha.md')]: VALID_RULE_MARKDOWN,
      [path.join(PROJECT_RULES_DIR, 'broken.md')]: new Error('read failed'),
    });
    const loader = await loadRuleLoader();

    const count = loader.loadProjectRules(WORKSPACE_ROOT);

    expect(count).toBe(1);
    expect(mockRuleEngine.registerProjectRuleSource).toHaveBeenCalledTimes(1);
    expect(mockLog.warnCore).toHaveBeenCalledWith(
      'RuleLoader',
      `Failed to read ${path.join(PROJECT_RULES_DIR, 'broken.md')}`,
    );
  });

  it('getRuleLayerInfo returns built-in and personal layers when no workspace is provided', async () => {
    mockDirectories({
      [BUILTIN_RULES_DIR]: ['builtin.md'],
      [PERSONAL_RULES_DIR]: ['personal.md', 'notes.txt'],
    });
    const loader = await loadRuleLoader();

    expect(loader.getRuleLayerInfo()).toEqual([
      { layer: 'built-in', directory: BUILTIN_RULES_DIR, exists: true, ruleCount: 1 },
      { layer: 'personal', directory: PERSONAL_RULES_DIR, exists: true, ruleCount: 1 },
    ]);
  });

  it('getRuleLayerInfo includes the project layer when a workspace root is provided', async () => {
    mockDirectories({
      [BUILTIN_RULES_DIR]: ['builtin.md'],
      [PERSONAL_RULES_DIR]: ['personal.md'],
      [PROJECT_RULES_DIR]: ['project.md', 'readme.txt'],
    });
    const loader = await loadRuleLoader();

    expect(loader.getRuleLayerInfo(WORKSPACE_ROOT)).toEqual([
      { layer: 'built-in', directory: BUILTIN_RULES_DIR, exists: true, ruleCount: 1 },
      { layer: 'personal', directory: PERSONAL_RULES_DIR, exists: true, ruleCount: 1 },
      { layer: 'project', directory: PROJECT_RULES_DIR, exists: true, ruleCount: 1 },
    ]);
  });

  it('getRuleLayerInfo reports missing directories as not existing', async () => {
    mockDirectories({
      [PERSONAL_RULES_DIR]: new Error('missing personal'),
      [BUILTIN_RULES_DIR]: new Error('missing builtin'),
      [PROJECT_RULES_DIR]: new Error('missing project'),
    });
    const loader = await loadRuleLoader();

    expect(loader.getRuleLayerInfo(WORKSPACE_ROOT)).toEqual([
      { layer: 'built-in', directory: BUILTIN_RULES_DIR, exists: false, ruleCount: 0 },
      { layer: 'personal', directory: PERSONAL_RULES_DIR, exists: false, ruleCount: 0 },
      { layer: 'project', directory: PROJECT_RULES_DIR, exists: false, ruleCount: 0 },
    ]);
  });

  it('getRuleLayerInfo counts only markdown files in each layer', async () => {
    mockDirectories({
      [BUILTIN_RULES_DIR]: ['builtin.md', 'ignore.txt', 'other.json'],
      [PERSONAL_RULES_DIR]: ['personal.md', 'draft.tmp'],
      [PROJECT_RULES_DIR]: ['project.md', 'project-2.md', 'notes.txt'],
    });
    const loader = await loadRuleLoader();

    expect(loader.getRuleLayerInfo(WORKSPACE_ROOT)).toEqual([
      { layer: 'built-in', directory: BUILTIN_RULES_DIR, exists: true, ruleCount: 1 },
      { layer: 'personal', directory: PERSONAL_RULES_DIR, exists: true, ruleCount: 1 },
      { layer: 'project', directory: PROJECT_RULES_DIR, exists: true, ruleCount: 2 },
    ]);
  });

  it('loadAllRuleLayers returns builtin, personal, and project counts', async () => {
    mockRuleEngine.loadBuiltinRules.mockReturnValue([{}, {}, {}]);
    mockDirectories({
      [BUILTIN_RULES_DIR]: ['builtin.md'],
      [PERSONAL_RULES_DIR]: ['personal.md'],
      [PROJECT_RULES_DIR]: ['project.md'],
    });
    mockFiles({
      [path.join(BUILTIN_RULES_DIR, 'builtin.md')]: VALID_RULE_MARKDOWN,
      [path.join(PERSONAL_RULES_DIR, 'personal.md')]: VALID_RULE_MARKDOWN,
      [path.join(PROJECT_RULES_DIR, 'project.md')]: VALID_RULE_MARKDOWN,
    });
    const loader = await loadRuleLoader();

    expect(loader.loadAllRuleLayers(WORKSPACE_ROOT)).toEqual({ builtin: 3, personal: 1, project: 1 });
    expect(mockRuleEngine.registerBuiltinRuleSource).toHaveBeenCalledTimes(1);
    expect(mockRuleEngine.clearLayerRules).toHaveBeenCalledWith('personal');
    expect(mockRuleEngine.clearLayerRules).toHaveBeenCalledWith('project');
  });

  it('loadAllRuleLayers skips project loading when no workspace root is provided', async () => {
    mockRuleEngine.loadBuiltinRules.mockReturnValue([{}]);
    mockDirectories({
      [BUILTIN_RULES_DIR]: ['builtin.md'],
      [PERSONAL_RULES_DIR]: ['personal.md'],
    });
    mockFiles({
      [path.join(BUILTIN_RULES_DIR, 'builtin.md')]: VALID_RULE_MARKDOWN,
      [path.join(PERSONAL_RULES_DIR, 'personal.md')]: VALID_RULE_MARKDOWN,
    });
    const loader = await loadRuleLoader();

    expect(loader.loadAllRuleLayers()).toEqual({ builtin: 1, personal: 1, project: 0 });
    expect(mockRuleEngine.registerProjectRuleSource).not.toHaveBeenCalled();
    expect(mockRuleEngine.clearLayerRules).not.toHaveBeenCalledWith('project');
  });

  it('loadAllRuleLayers uses the default trust gate for both personal and project rules', async () => {
    const personalPath = path.join(PERSONAL_RULES_DIR, 'personal.md');
    const projectPath = path.join(PROJECT_RULES_DIR, 'project.md');
    const gate = makeTrustGate(() => false);
    mockRuleEngine.loadBuiltinRules.mockReturnValue([]);
    mockDirectories({
      [BUILTIN_RULES_DIR]: [],
      [PERSONAL_RULES_DIR]: ['personal.md'],
      [PROJECT_RULES_DIR]: ['project.md'],
    });
    mockFiles({
      [personalPath]: VALID_RULE_MARKDOWN,
      [projectPath]: VALID_RULE_MARKDOWN,
    });
    const loader = await loadRuleLoader();
    loader.setDefaultTrustGate(gate);

    expect(loader.loadAllRuleLayers(WORKSPACE_ROOT)).toEqual({ builtin: 0, personal: 0, project: 0 });
    expect(gate.onBlockedMock).toHaveBeenNthCalledWith(1, {
      filePath: personalPath,
      layer: 'personal',
      kind: 'rule',
      hash: hashContent(VALID_RULE_MARKDOWN),
      content: VALID_RULE_MARKDOWN,
    });
    expect(gate.onBlockedMock).toHaveBeenNthCalledWith(2, {
      filePath: projectPath,
      layer: 'project',
      kind: 'rule',
      hash: hashContent(VALID_RULE_MARKDOWN),
      content: VALID_RULE_MARKDOWN,
    });
  });

  it('registerAllBuiltinMetrics loads only .metric.md files and registers parsed metrics', async () => {
    mockDirectories({
      [BUILTIN_METRICS_DIR]: ['metric-1.metric.md', 'notes.md', 'metric-2.metric.md'],
    });
    mockFiles({
      [path.join(BUILTIN_METRICS_DIR, 'metric-1.metric.md')]: 'metric-1 markdown',
      [path.join(BUILTIN_METRICS_DIR, 'metric-2.metric.md')]: 'metric-2 markdown',
    });
    const loader = await loadRuleLoader();

    expect(loader.registerAllBuiltinMetrics()).toBe(2);
    expect(mockMetricEngine.parseMetric).toHaveBeenCalledTimes(2);
    expect(mockMetricEngine.registerMetric).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ source: 'built-in', sourceFilePath: path.join(BUILTIN_METRICS_DIR, 'metric-1.metric.md') }),
    );
    expect(mockMetricEngine.registerMetric).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ source: 'built-in', sourceFilePath: path.join(BUILTIN_METRICS_DIR, 'metric-2.metric.md') }),
    );
  });

  it('registerAllBuiltinMetrics falls back to the source metrics directory', async () => {
    mockDirectories({
      [BUILTIN_METRICS_DIR]: new Error('missing dist metrics'),
      [FALLBACK_METRICS_DIR]: ['metric-1.metric.md'],
    });
    mockFiles({
      [path.join(FALLBACK_METRICS_DIR, 'metric-1.metric.md')]: 'metric-1 markdown',
    });
    const loader = await loadRuleLoader();

    expect(loader.registerAllBuiltinMetrics()).toBe(1);
    expect(mockFs.readdirSync).toHaveBeenCalledWith(BUILTIN_METRICS_DIR);
    expect(mockFs.readdirSync).toHaveBeenCalledWith(FALLBACK_METRICS_DIR);
  });

  it('loadPersonalMetrics rejects blocked metric files and reports their hash', async () => {
    const filePath = path.join(PERSONAL_METRICS_DIR, 'metric-1.metric.md');
    const gate = makeTrustGate(() => false);
    mockDirectories({
      [PERSONAL_METRICS_DIR]: ['metric-1.metric.md'],
    });
    mockFiles({
      [filePath]: 'metric-1 markdown',
    });
    const loader = await loadRuleLoader();

    expect(loader.loadPersonalMetrics(gate)).toBe(0);
    expect(mockMetricEngine.parseMetric).not.toHaveBeenCalled();
    expect(gate.onBlockedMock).toHaveBeenCalledWith({
      filePath,
      layer: 'personal',
      kind: 'metric',
      hash: hashContent('metric-1 markdown'),
      content: 'metric-1 markdown',
    });
  });

  it('loadProjectMetrics returns 0 when the project metrics directory is missing', async () => {
    const loader = await loadRuleLoader();

    expect(loader.loadProjectMetrics(WORKSPACE_ROOT)).toBe(0);
    expect(mockMetricEngine.registerMetric).not.toHaveBeenCalled();
  });

  it('loadAllMetricLayers clears metrics and returns counts from each layer', async () => {
    mockDirectories({
      [BUILTIN_METRICS_DIR]: ['metric-1.metric.md'],
      [PERSONAL_METRICS_DIR]: ['metric-2.metric.md'],
      [PROJECT_METRICS_DIR]: ['metric-3.metric.md'],
    });
    mockFiles({
      [path.join(BUILTIN_METRICS_DIR, 'metric-1.metric.md')]: 'metric-1 markdown',
      [path.join(PERSONAL_METRICS_DIR, 'metric-2.metric.md')]: 'metric-2 markdown',
      [path.join(PROJECT_METRICS_DIR, 'metric-3.metric.md')]: 'metric-3 markdown',
    });
    const loader = await loadRuleLoader();

    expect(loader.loadAllMetricLayers(WORKSPACE_ROOT)).toEqual({ builtin: 1, personal: 1, project: 1 });
    expect(mockMetricEngine.clearMetrics).toHaveBeenCalledTimes(1);
    expect(mockMetricEngine.registerMetric).toHaveBeenCalledTimes(3);
  });
});
