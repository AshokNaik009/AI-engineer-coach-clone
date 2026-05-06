import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, bench, afterAll } from 'vitest';
import { reconstructFromJsonl } from './parser-vscode-files';
import { evaluateExpression, compileFilter } from './dsl/index';
import { executePipeline, parsePipeline } from './rule-pipeline';
import type { DetectionRule, Session, SessionRequest } from './types';
import type { DetectorContext } from './rule-pipeline';
import { Analyzer } from './analyzer';

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateJsonlLines(count: number): string {
  const lines: string[] = [];
  lines.push(JSON.stringify({ kind: 0, v: { sessions: [] } }));
  for (let i = 0; i < count; i++) {
    lines.push(JSON.stringify({
      kind: 1,
      k: ['sessions', i],
      v: { id: `s${i}`, timestamp: Date.now() - i * 1000 },
    }));
  }
  return lines.join('\n');
}

function makeRequest(i: number): SessionRequest {
  return {
    requestId: `r${i}`,
    timestamp: Date.now() - i * 60000,
    messageText: `Please fix the bug in file${i}.ts`,
    responseText: `I'll help you fix the bug. Here's the updated code for file${i}.ts...`,
    isCanceled: false,
    agentName: 'copilot',
    agentMode: 'chat',
    modelId: 'gpt-4o',
    toolsUsed: i % 3 === 0 ? ['terminal'] : [],
    editedFiles: i % 2 === 0 ? [`src/file${i}.ts`] : [],
    referencedFiles: [`src/ref${i}.ts`],
    slashCommand: '',
    variableKinds: {},
    customInstructions: [],
    skillsUsed: [],
    firstProgress: 200,
    totalElapsed: 1500 + i * 10,
    messageLength: 30,
    responseLength: 150,
    userCode: [],
    aiCode: [{ language: 'typescript', loc: 10 + i }],
    toolConfirmations: [],
    promptTokens: 500,
    completionTokens: 200,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    compaction: null,
    todoSnapshot: null,
    workType: i % 2 === 0 ? 'feature' : 'bug-fix',
  };
}

function makeSession(id: number, reqCount: number): Session {
  const requests = Array.from({ length: reqCount }, (_, i) => makeRequest(i));
  return {
    sessionId: `session-${id}`,
    workspaceId: `ws-${id % 5}`,
    workspaceName: `project-${id % 5}`,
    location: '/workspace/project',
    harness: 'vscode',
    creationDate: Date.now() - id * 3600000,
    lastMessageDate: Date.now() - id * 1800000,
    requestCount: reqCount,
    requests,
  };
}

function makeRule(matchExpr: string, checkExpr: string): DetectionRule {
  return {
    id: 'bench-rule',
    name: 'Benchmark Rule',
    group: 'prompt-quality',
    severity: 'medium',
    requiresIdeContext: false,
    scope: 'requests',
    description: 'A rule for benchmarking',
    descriptionTemplate: '{{count}} of {{total}} requests matched',
    suggestionTemplate: 'Consider improving prompts',
    exampleTemplate: '{{messageText}}',
    maxExamples: 3,
    conditions: [],
    thresholds: { min: 3 },
    patterns: {},
    fileTypes: {},
    tests: [],
    source: 'built-in',
    sourceFilePath: '',
    version: 1,
    tags: [],
    rawSource: `\`\`\`detect\nscan: requests\nmatch: ${matchExpr}\naggregate: count\ncheck: ${checkExpr}\n\`\`\``,
  };
}

// ─── JSONL Parser Benchmarks ────────────────────────────────────────────────

const benchTmpDir = mkdtempSync(join(tmpdir(), 'bench-'));
const smallFile = join(benchTmpDir, 'small.jsonl');
const medFile = join(benchTmpDir, 'medium.jsonl');
const largeFile = join(benchTmpDir, 'large.jsonl');
writeFileSync(smallFile, generateJsonlLines(100));
writeFileSync(medFile, generateJsonlLines(1000));
writeFileSync(largeFile, generateJsonlLines(10000));

describe('JSONL Parser', () => {
  afterAll(() => {
    rmSync(benchTmpDir, { recursive: true, force: true });
  });

  bench('reconstructFromJsonl - 100 lines', () => {
    reconstructFromJsonl(smallFile);
  });

  bench('reconstructFromJsonl - 1000 lines', () => {
    reconstructFromJsonl(medFile);
  });

  bench('reconstructFromJsonl - 10000 lines', () => {
    reconstructFromJsonl(largeFile);
  });
});

// ─── DSL Benchmarks ─────────────────────────────────────────────────────────

describe('DSL Evaluation', () => {
  const simpleCtx = { requestCount: 10, messageLength: 50, totalElapsed: 2000 };
  const complexCtx = {
    messageText: 'Please fix the authentication bug in login.ts',
    editedFiles: ['src/auth.ts', 'src/login.ts'],
    toolsUsed: ['terminal', 'search'],
    responseLength: 500,
    isCanceled: false,
  };

  bench('simple comparison: requestCount > 5', () => {
    evaluateExpression('requestCount > 5', simpleCtx);
  });

  bench('arithmetic: totalElapsed / 1000', () => {
    evaluateExpression('totalElapsed / 1000', simpleCtx);
  });

  bench('function call: length(editedFiles) > 0', () => {
    evaluateExpression('length(editedFiles) > 0', complexCtx);
  });

  bench('contains + AND: contains(messageText, "fix") AND length(editedFiles) > 0', () => {
    evaluateExpression('contains(messageText, "fix") AND length(editedFiles) > 0', complexCtx);
  });

  bench('compileFilter with complex expression', () => {
    const fn = compileFilter('length(toolsUsed) > 1 AND responseLength > 100');
    fn(complexCtx);
  });
});

// ─── Rule Pipeline Benchmarks ───────────────────────────────────────────────

describe('Rule Pipeline', () => {
  const sessions = Array.from({ length: 10 }, (_, i) => makeSession(i, 5));
  const reqs = sessions.flatMap(s => s.requests) as unknown as SessionRequest[];

  const simpleRule = makeRule('messageLength > 10', 'count > 3');
  const complexRule = makeRule(
    'contains(messageText, "fix") AND length(editedFiles) > 0',
    'ratio > 0.3',
  );

  bench('simple match pipeline (50 requests)', () => {
    const pipeline = parsePipeline(simpleRule);
    const ctx: DetectorContext = { reqs, sessions, skipIdeDetectors: false };
    executePipeline(pipeline, simpleRule, ctx);
  });

  bench('complex match pipeline (50 requests)', () => {
    const pipeline = parsePipeline(complexRule);
    const ctx: DetectorContext = { reqs, sessions, skipIdeDetectors: false };
    executePipeline(pipeline, complexRule, ctx);
  });

  const largeSessions = Array.from({ length: 50 }, (_, i) => makeSession(i, 10));
  const largeReqs = largeSessions.flatMap(s => s.requests) as unknown as SessionRequest[];

  bench('pipeline with 500 requests', () => {
    const pipeline = parsePipeline(complexRule);
    const ctx: DetectorContext = { reqs: largeReqs, sessions: largeSessions, skipIdeDetectors: false };
    executePipeline(pipeline, complexRule, ctx);
  });
});

// ─── Analyzer Throughput Benchmarks ─────────────────────────────────────────

describe('Analyzer Throughput', () => {
  const sessions10 = Array.from({ length: 10 }, (_, i) => makeSession(i, 5));
  const sessions100 = Array.from({ length: 100 }, (_, i) => makeSession(i, 3));
  const sessions500 = Array.from({ length: 500 }, (_, i) => makeSession(i, 2));

  bench('Analyzer.getStats - 10 sessions', () => {
    const analyzer = new Analyzer(sessions10);
    analyzer.getStats();
  });

  bench('Analyzer.getStats - 100 sessions', () => {
    const analyzer = new Analyzer(sessions100);
    analyzer.getStats();
  });

  bench('Analyzer.getStats - 500 sessions', () => {
    const analyzer = new Analyzer(sessions500);
    analyzer.getStats();
  });
});
