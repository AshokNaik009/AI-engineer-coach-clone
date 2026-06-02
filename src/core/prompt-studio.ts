/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Prompt Studio core engine — pure, no VS Code dependency.
 *
 * Wraps a single draft prompt as a synthetic `Session` so the existing
 * data-driven rule engine can score it, then curates the subset of rules that
 * are meaningful on a single prompt (n=1).
 *
 * ## Why a curated subset?
 * Most of the shipped rules are ratio/aggregate-scoped ("30% of requests are
 * short", gated by `minSample`). Those gates live in the rule's `check:`
 * directive (evaluated by `checkPipelineTrigger`), not in the match. On a
 * single synthetic request a matching prompt yields `count:1, total:1`, so we
 * lower each rule's sample-size gate to n=1 via a per-rule threshold override
 * and let the rule's own `check:` logic decide. The match predicate — the part
 * that actually evaluates *this* prompt's content — is preserved untouched.
 *
 * ## What's excluded
 * `context-engineering-gaps` audits the developer's whole setup (sub-agents,
 * skills, MCP, instructions). On a synthetic single prompt it would always
 * report "5/5 missing", which is misleading — so it feeds the personalization
 * *profile* (computed over real history) rather than the per-prompt diagnosis.
 */

import type { Session, SessionRequest, DetectionRule, SessionIntent } from './types';
import type {
  StudioInput,
  StudioIssue,
  StudioProfile,
  StudioProfilePattern,
  StudioCost,
} from './types/prompt-studio-types';
import { parsePipeline, executePipeline, checkPipelineTrigger, resolveInheritance } from './rule-pipeline';
import { runDetectors } from './detector-registry';
import { tokenCostInCredits, classifyWorkType } from './helpers';

/* ================================================================== */
/*  Curated single-prompt rule subset                                 */
/* ================================================================== */

/**
 * Per-rule adaptation for n=1 evaluation:
 *  - `thresholds` — overrides merged onto the rule's frontmatter thresholds,
 *    lowering sample-size gates so a single matching prompt can trigger.
 *  - `intents` — only evaluate this rule when the draft's classified intent is
 *    in this set (e.g. file-context rules only matter for code work).
 *  - `sessionShape` / `requestShape` — synthetic shaping needed by
 *    session-scoped rules whose match gates on session structure.
 */
interface StudioRuleConfig {
  thresholds?: Record<string, number>;
  intents?: SessionIntent[];
  sessionShape?: Partial<Session>;
  requestShape?: Partial<SessionRequest>;
}

/** Display order (roughly: content quality → cost/routing → structure). */
export const STUDIO_RULE_ORDER: readonly string[] = [
  'lazy-prompting',
  'low-constraint-usage',
  'no-spec-structure',
  'verbose-prompt-no-compression',
  'caps-lock',
  'profanity',
  'no-file-context',
  'excessive-file-context',
  'agent-mode-for-asks',
  'premium-for-lookup-questions',
];

const STUDIO_RULES: Record<string, StudioRuleConfig> = {
  // ratio + minSample(10): lower the sample gate so one short prompt triggers.
  'lazy-prompting': { thresholds: { minSample: 0 } },
  // count over substantial reqs, gated by minReqs(30).
  'low-constraint-usage': { thresholds: { minReqs: 1 } },
  // ratio + minSample(15).
  'verbose-prompt-no-compression': { thresholds: { minSample: 0 } },
  // already minReqs:1 — no override needed.
  'caps-lock': {},
  'profanity': {},
  // file-context only matters for code work; gate by intent.
  'no-file-context': { thresholds: { minSample: 0 }, intents: ['Implementation', 'Debugging', 'Review'] },
  // outlier rule: lower outlier count to 1, the file threshold to a
  // single-prompt-sensible value, and drop the population ratio gate.
  'excessive-file-context': { thresholds: { minOutliers: 1, minFiles: 12, maxRatio: 0 } },
  // match already requires agentMode=="agent"; just lower the sample gate.
  'agent-mode-for-asks': { thresholds: { minSample: 0 } },
  // match already requires a premium model + lookup phrasing.
  'premium-for-lookup-questions': { thresholds: { minSample: 0 } },
  // session-scoped: match gates on requestCount>=3 + an agent-mode request.
  // Shape the synthetic session so the *structural* check is what decides,
  // and only run it for build-style intents.
  'no-spec-structure': {
    thresholds: { minAgentSessions: 1 },
    intents: ['Implementation', 'Planning', 'Debugging'],
    sessionShape: { requestCount: 3 },
    requestShape: { agentMode: 'agent' },
  },
};

/* ================================================================== */
/*  Synthetic session adapter                                         */
/* ================================================================== */

function makePlaceholderFiles(prefix: string, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(`${prefix}-${i + 1}.ts`);
  return out;
}

/** Build a single synthetic `SessionRequest` from a draft, defaulting every
 *  field the content rules read to a neutral value. */
export function buildSyntheticRequest(input: StudioInput): SessionRequest {
  const text = input.text ?? '';
  const refCount = Math.max(0, Math.floor(input.referencedFileCount ?? 0));
  const editCount = Math.max(0, Math.floor(input.editedFileCount ?? 0));
  return {
    requestId: 'studio-draft',
    timestamp: null,
    messageText: text,
    responseText: '',
    isCanceled: false,
    agentName: '',
    agentMode: input.agentMode ?? 'chat',
    modelId: input.modelId ?? '',
    toolsUsed: [],
    editedFiles: makePlaceholderFiles('edited', editCount),
    referencedFiles: makePlaceholderFiles('context', refCount),
    slashCommand: input.slashCommand ?? '',
    variableKinds: {},
    customInstructions: [],
    skillsUsed: [],
    firstProgress: null,
    totalElapsed: null,
    messageLength: text.length,
    responseLength: 0,
    userCode: [],
    aiCode: [],
    toolConfirmations: [],
    promptTokens: null,
    completionTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    compaction: null,
    todoSnapshot: null,
    workType: '',
  };
}

/** Wrap a request as a one-request synthetic `Session`. */
export function buildSyntheticSession(request: SessionRequest, shape?: Partial<Session>): Session {
  return {
    sessionId: 'studio-session',
    workspaceId: '',
    workspaceName: 'Prompt Studio',
    location: '',
    harness: 'Studio',
    creationDate: null,
    lastMessageDate: null,
    requestCount: 1,
    requests: [request],
    ...shape,
  };
}

/* ================================================================== */
/*  Intent classification (mirrors analyzer-insights.classifyIntent)  */
/* ================================================================== */
/* Replicated here to keep this core module decoupled from the analyzer
 * class graph. Keep in sync with src/core/analyzer-insights.ts. */

const PLANNING_RE = /\b(plan|architect|design|outline|approach|strategy|scope|breakdown|roadmap|RFC|spec|proposal)\b/i;
const DEBUG_RE = /\b(fix|bug|error|exception|crash|debug|stacktrace|trace|issue|broken|fail|wrong|not working|undefined is not|cannot read|segfault|panic)\b/i;
const REVIEW_RE = /\b(review|explain|understand|what does|how does|walk me through|read|audit|analyze|inspect|clarify|describe)\b/i;
const EXPLORE_RE = /\b(how to|what is|can I|learn|explore|example|tutorial|demo|try|experiment|compare|research|playground)\b/i;
const INTENTS: SessionIntent[] = ['Planning', 'Implementation', 'Debugging', 'Review', 'Exploration'];

export function classifyDraftIntent(session: Session): SessionIntent {
  const scores: Record<SessionIntent, number> = {
    Planning: 0, Implementation: 0, Debugging: 0, Review: 0, Exploration: 0,
  };
  for (const r of session.requests) {
    const msg = r.messageText;
    if (r.agentMode.includes('plan') || r.slashCommand === 'plan' || PLANNING_RE.test(msg)) scores.Planning++;
    if (DEBUG_RE.test(msg) || r.slashCommand === 'fix') scores.Debugging++;
    if (REVIEW_RE.test(msg) || r.slashCommand === 'explain') scores.Review++;
    if (EXPLORE_RE.test(msg)) scores.Exploration++;
    if (r.aiCode.length > 0 || r.editedFiles.length > 0) scores.Implementation++;
    const wt = r.workType || classifyWorkType(msg);
    if (wt === 'feature' || wt === 'refactor' || wt === 'test' || wt === 'config' || wt === 'style') scores.Implementation++;
  }
  let best: SessionIntent = 'Implementation';
  let max = 0;
  for (const intent of INTENTS) {
    if (scores[intent] > max) { max = scores[intent]; best = intent; }
  }
  return best;
}

/* ================================================================== */
/*  Diagnosis                                                         */
/* ================================================================== */

/**
 * Diagnose a single draft against the curated subset. Returns the rules that
 * fired, presented with their name + "How to Improve" guidance (the right voice
 * for n=1) rather than the ratio-phrased description template.
 *
 * @param allRules - the full rule set (pass `getAllRules()` from the caller).
 */
export function diagnosePrompt(input: StudioInput, allRules: DetectionRule[]): StudioIssue[] {
  const baseRequest = buildSyntheticRequest(input);
  const intent = classifyDraftIntent(buildSyntheticSession(baseRequest));
  const byId = new Map(allRules.map(r => [r.id, r]));
  const issues: StudioIssue[] = [];

  for (const ruleId of STUDIO_RULE_ORDER) {
    const rule = byId.get(ruleId);
    if (!rule) continue;
    const cfg = STUDIO_RULES[ruleId] ?? {};
    if (cfg.intents && !cfg.intents.includes(intent)) continue;

    // Clone the rule with n=1-tuned thresholds; rawSource (and thus the match
    // predicate) is untouched, so only sample gates change.
    const tuned: DetectionRule = cfg.thresholds
      ? { ...rule, thresholds: { ...rule.thresholds, ...cfg.thresholds } }
      : rule;
    const resolved = resolveInheritance(tuned);

    const request = cfg.requestShape ? { ...baseRequest, ...cfg.requestShape } : baseRequest;
    const session = buildSyntheticSession(request, cfg.sessionShape);

    try {
      const pipeline = parsePipeline(resolved);
      const emission = executePipeline(pipeline, resolved, {
        reqs: [request],
        sessions: [session],
        skipIdeDetectors: false,
      });
      if (!checkPipelineTrigger(pipeline, emission, resolved)) continue;
      issues.push({
        ruleId: rule.id,
        ruleName: rule.name,
        severity: emission.dynamicSeverity ?? rule.severity,
        group: rule.group,
        suggestion: rule.suggestionTemplate || rule.description,
        example: emission.examples[0],
      });
    } catch {
      // A rule whose DSL can't evaluate on synthetic data is simply skipped.
      continue;
    }
  }

  return issues;
}

/* ================================================================== */
/*  Personalization profile                                           */
/* ================================================================== */

const CONTEXT_GAP_LABELS: Record<string, string> = {
  gap1: 'No custom sub-agents in use',
  gap2: 'No skills (SKILL.md) detected',
  gap3: 'No MCP tools connected',
  gap4: 'Files rarely referenced as context',
  gap5: 'No custom instructions (.instructions.md)',
};

/** Minimum real requests before context-engineering gaps are trustworthy. */
const MIN_HISTORY_FOR_GAPS = 10;

/**
 * Assemble the personalization context from the developer's real history:
 * habitual anti-patterns (most frequent first) + the draft's intent + the
 * developer's context-engineering gaps. This is what makes advice specific to
 * *this* developer rather than generic.
 */
export function assembleProfile(
  sessions: Session[],
  input: StudioInput,
  allRules: DetectionRule[],
): StudioProfile {
  const reqs = sessions.flatMap(s => s.requests);
  const intent = classifyDraftIntent(buildSyntheticSession(buildSyntheticRequest(input)));

  let topPatterns: StudioProfilePattern[] = [];
  if (reqs.length > 0) {
    const patterns = runDetectors(reqs, sessions, false);
    topPatterns = patterns
      .map(p => ({ id: p.id, name: p.name, occurrences: p.occurrences }))
      .sort((a, b) => b.occurrences - a.occurrences)
      .slice(0, 5);
  }

  const contextGaps = computeContextGaps(reqs, sessions, allRules);

  return { intent, topPatterns, contextGaps, sampleSize: reqs.length };
}

function computeContextGaps(
  reqs: SessionRequest[],
  sessions: Session[],
  allRules: DetectionRule[],
): string[] {
  if (reqs.length < MIN_HISTORY_FOR_GAPS) return [];
  const rule = allRules.find(r => r.id === 'context-engineering-gaps');
  if (!rule) return [];
  try {
    const pipeline = parsePipeline(resolveInheritance(rule));
    const emission = executePipeline(pipeline, rule, { reqs, sessions, skipIdeDetectors: false });
    const gaps: string[] = [];
    for (const [key, label] of Object.entries(CONTEXT_GAP_LABELS)) {
      if (emission.extra[key]) gaps.push(label);
    }
    return gaps;
  } catch {
    return [];
  }
}

/* ================================================================== */
/*  Cost preview                                                      */
/* ================================================================== */

/** Default model for cost estimates when the draft has no model set. */
const DEFAULT_COST_MODEL = 'claude-opus-4-8';

/**
 * Rough input-token estimate (~4 chars/token). Deliberately a heuristic — the
 * Studio cost panel is labeled as an estimate and ships behind the token
 * reporting flag for real credits.
 */
export function estimateTokens(text: string): number {
  return Math.ceil((text ?? '').length / 4);
}

/**
 * Build the cost preview for a prompt. Credits are only populated when token
 * reporting is enabled; otherwise the token estimate stands alone.
 */
export function buildCost(text: string, model: string | undefined, reportingEnabled: boolean): StudioCost {
  const tokens = estimateTokens(text);
  const costModel = model && model.length > 0 ? model : DEFAULT_COST_MODEL;
  if (!reportingEnabled) {
    return { tokens, credits: null, reportingEnabled: false };
  }
  const credits = Math.round(tokenCostInCredits(costModel, tokens, 0) * 100) / 100;
  return { tokens, credits, reportingEnabled: true, model: costModel };
}
