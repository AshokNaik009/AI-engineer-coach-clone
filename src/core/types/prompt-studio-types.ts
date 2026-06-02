/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Wire types for the Prompt Studio feature: a Copilot-free page that diagnoses a
 * single prompt, previews its token cost, and produces an improved prompt via the
 * local `claude -p` binary. Kept dependency-free so both the pure core
 * (prompt-studio.ts, claude-cli.ts) and the RPC layer can share them. */

import type { RuleSeverity } from './rule-types';
import type { PracticeGroup } from './analytics-types';
import type { SessionIntent } from './insights-types';

/**
 * A prompt to diagnose. In Compose mode every field is user-supplied; in History
 * mode the fields are lifted off a real past SessionRequest. The optional fields
 * default to neutral values (no files, chat mode, no model) so a bare draft is
 * diagnosable.
 */
export interface StudioInput {
  /** The prompt text itself. */
  text: string;
  /** Chat mode the prompt was/would-be sent in (e.g. 'agent', 'chat', 'ask'). */
  agentMode?: string;
  /** Model the prompt was/would-be routed to (e.g. 'claude-opus-4-8'). Empty = unknown. */
  modelId?: string;
  /** Slash command in play (e.g. 'plan', 'fix'), if any. */
  slashCommand?: string;
  /** How many files are referenced as context (#file etc.). Drives file-context rules. */
  referencedFileCount?: number;
  /** How many files are open/edited in the workspace. Drives file-context rules. */
  editedFileCount?: number;
}

/** One diagnosis finding: a curated single-prompt rule that fired on the draft. */
export interface StudioIssue {
  ruleId: string;
  ruleName: string;
  severity: RuleSeverity;
  group: PracticeGroup;
  /** The rule's "How to Improve" guidance (suggestionTemplate), the right voice for n=1. */
  suggestion: string;
  /** A short, single-prompt example string when the rule produced one. */
  example?: string;
}

/** One habitual anti-pattern the developer trips most often, from their real history. */
export interface StudioProfilePattern {
  id: string;
  name: string;
  /** Number of real requests/sessions this pattern flagged in the filtered history. */
  occurrences: number;
}

/**
 * The personalization context that makes advice specific to *this* developer:
 * their habitual anti-patterns + the detected intent of the current draft +
 * their context-engineering gaps (whole-setup audit, NOT a per-prompt signal).
 */
export interface StudioProfile {
  /** Detected intent of the current draft. */
  intent: SessionIntent;
  /** Top anti-patterns from real history, most frequent first. */
  topPatterns: StudioProfilePattern[];
  /** Human-readable context-engineering gaps (e.g. "no custom instructions"). */
  contextGaps: string[];
  /** How many real requests the profile was computed over (0 = no history). */
  sampleSize: number;
}

/** Token/credit cost preview for a prompt. Credits are flag-gated; estimates always present. */
export interface StudioCost {
  /** Estimated input tokens for the prompt (heuristic). */
  tokens: number;
  /** Estimated cost in credits, or null when token reporting is disabled/unavailable. */
  credits: number | null;
  /** Whether real credit reporting is enabled (FF_TOKEN_REPORTING_ENABLED). */
  reportingEnabled: boolean;
  /** Model used for the credit estimate, when credits are present. */
  model?: string;
}

/** Result of diagnosing a single prompt: issues + personalization + cost. */
export interface StudioDiagnosis {
  issues: StudioIssue[];
  profile: StudioProfile;
  cost: StudioCost;
}

/** A past prompt surfaced for the History tab. */
export interface StudioRecentPrompt {
  sessionId: string;
  requestId: string;
  /** Truncated preview for the list. */
  preview: string;
  /** Full text for diagnosing/coaching. */
  text: string;
  agentMode: string;
  modelId: string;
  slashCommand: string;
  referencedFileCount: number;
  editedFileCount: number;
  workspaceName: string;
  timestamp: number | null;
}

/** Input to the `claude -p` suggestion engine. */
export interface ClaudeImproveInput {
  /** The draft prompt to improve. */
  text: string;
  /** Issues found by the heuristic diagnosis (rule name + suggestion). */
  issues: StudioIssue[];
  /** Personalization context. */
  profile: StudioProfile;
}

/** Usage/cost reported by the `claude -p` JSON envelope, when present. */
export interface ClaudeImproveUsage {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

/**
 * Result of the suggestion engine. `source` distinguishes a real `claude -p`
 * response from the deterministic heuristic fallback (binary missing/errored),
 * so the UI can label it honestly.
 */
export interface ClaudeImproveResult {
  advice: string[];
  improvedPrompt: string;
  whatChanged: string[];
  source: 'claude' | 'fallback';
  /** Present only when source==='claude' and the envelope reported usage. */
  usage?: ClaudeImproveUsage;
  /** Reason the fallback was used, when source==='fallback'. */
  error?: string;
}
