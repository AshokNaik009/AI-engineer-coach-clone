/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AntiPattern } from './analytics-types';

/* ---- Context Management (token-level health) ---- */

export interface ContextVerdictThresholds {
  optimalUtilization: number;
  limitedUtilization: number;
  adaptive: boolean;
  sampleSize: number;
}

export interface WorkspaceContextScore {
  workspaceId: string;
  workspaceName: string;
  harness: string;
  sessionCount: number;
  requestsWithTokens: number;
  avgPromptTokens: number;
  maxPromptTokens: number;
  /** Percentage of estimated context window used on average (0-100) */
  avgUtilization: number;
  /** Percentage of estimated context window used at peak (0-100) */
  peakUtilization: number;
  /** Percentage of requests that are at or above the saturation threshold (60% utilization) */
  saturation: number;
  compactionCount: number;
  /** Reserved for compatibility; context views no longer surface cost efficiency */
  costEfficiency: number | null;
  /** Composite score 0-100 — higher is better context hygiene */
  score: number;
  verdict: 'optimal' | 'degraded' | 'limited';
}

export interface ContextTrend {
  label: string;  // week label
  avgUtilization: number;
  compactions: number;
  sessionsOverThreshold: number;
}

/** Per-workspace weekly utilization data for the trend chart "per-workspace" view */
export interface WorkspaceTrendSeries {
  workspaceName: string;
  /** Sparse array aligned to the same week labels as ContextTrend[], null = no data that week */
  data: (number | null)[];
}

/** A timeline event that occurred during a session (compaction, todo change, etc.) */
export interface SessionTimelineEvent {
  /** 0-based request index within the session */
  requestIndex: number;
  type: 'compaction' | 'todo-add' | 'todo-progress' | 'todo-complete';
  label: string;
}

/** Per-session context detail returned when drilling into a workspace */
export interface SessionContextDetail {
  sessionId: string;
  date: string;
  harness: string;
  requestCount: number;
  requestsWithTokens: number;
  avgPromptTokens: number;
  maxPromptTokens: number;
  avgUtilization: number;
  peakUtilization: number;
  contextWindow: number;
  compactionCount: number;
  /** Token counts per request (for sparkline / token curve). `null` for
   *  requests without native token data — keeps the request index aligned
   *  with `events` and `requestQueries` while telling the chart to draw a
   *  gap rather than a misleading 0 dip. */
  tokenCurve: (number | null)[];
  /** Percentage of requests at or above the saturation threshold */
  saturation: number;
  /** Reserved for compatibility; context views no longer surface cost efficiency */
  costEfficiency: number | null;
  verdict: 'optimal' | 'degraded' | 'limited';
  /** Timeline events (compactions, todo additions/completions) indexed by request */
  events: SessionTimelineEvent[];
  /** Truncated user query per request (aligned with tokenCurve) for tooltip display */
  requestQueries: string[];
  /** True when per-request token data is available (enables token curve chart).
   *  False for harnesses that only report session-aggregated tokens (e.g. Copilot CLI). */
  hasPerRequestTokens: boolean;
}

export interface WorkspaceContextSessionsData {
  workspaceName: string;
  estimatedContextWindow: number;
  thresholds: ContextVerdictThresholds;
  sessions: SessionContextDetail[];
}

export interface ContextManagementData {
  /** Overall context health score 0-100 */
  overallScore: number;
  /** Estimated context window size (tokens) based on observed maximums */
  estimatedContextWindow: number;
  /** Verdict cutoffs used for this filtered dataset */
  thresholds: ContextVerdictThresholds;
  /** Per-workspace breakdown */
  workspaces: WorkspaceContextScore[];
  /** Weekly trend data */
  trend: ContextTrend[];
  /** Per-workspace weekly trend (top 10 by request volume) */
  workspaceTrend: WorkspaceTrendSeries[];
  /** Total compaction events observed */
  totalCompactions: number;
  /** Full (deep summarization) compaction events — automated context management */
  fullCompactions: number;
  /** Simple (lightweight truncation) compaction events */
  simpleCompactions: number;
  /** Sessions with token data available */
  sessionsWithTokenData: number;
  totalSessions: number;
  /** Anti-patterns specific to context management */
  antiPatterns: AntiPattern[];
  /** Actionable tips based on observed patterns */
  tips: string[];
}

/* ---- Context Review (agent-based) ---- */

export type ContextReviewCategory =
  | 'clarity'          // Is the intent clear to an AI agent?
  | 'specificity'      // Are constraints, tech stack, coding standards defined?
  | 'structure'        // Headings, sections, frontmatter, logical ordering
  | 'completeness'     // Missing typical sections (project overview, conventions, testing, etc.)
  | 'staleness'        // Outdated references, deprecated patterns
  | 'redundancy'       // Duplicated info across files, conflicting instructions
  | 'actionability';   // Can the AI act on these instructions or are they too vague?

export interface ContextReviewFinding {
  category: ContextReviewCategory;
  severity: 'good' | 'warning' | 'critical';
  file: string;
  finding: string;
  suggestion: string;
}

export interface ContextReviewResult {
  workspaceId: string;
  workspaceName: string;
  overallGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  overallScore: number;           // 0-100
  categoryScores: Record<ContextReviewCategory, number>;  // 0-100 each
  findings: ContextReviewFinding[];
  summary: string;
}

/* ---- Agentic Readiness Score ---- */

export interface AgenticReadinessScore {
  score: number;                  // 0-100
  signals: AgenticReadinessSignal[];
}

export interface AgenticReadinessSignal {
  id: string;
  label: string;
  present: boolean;
  weight: number;
  detail: string;
}

/* ---- Flow State Analysis ---- */

export interface FlowSession {
  sessionId: string;
  workspaceName: string;
  harness: string;
  date: string;
  startTs: number;
  endTs: number;
  durationMin: number;
  requestCount: number;
  /** Median follow-up latency in seconds (time from response to next prompt) */
  medianFollowUpSec: number;
  /** Under 30s follow-up rate — fraction of gaps where user replied within 30s */
  rapidFollowUpRate: number;
  /** 0-100 flow score for this session */
  flowScore: number;
  flowLabel: 'deep' | 'moderate' | 'shallow' | 'fragmented';
}

export interface FlowDay {
  date: string;
  /** Longest uninterrupted work block in minutes */
  longestBlockMin: number;
  /** Total continuous hours on projects */
  totalHours: number;
  /** Number of distinct work blocks (gap > 15 min = new block) */
  blockCount: number;
  /** Average flow score across sessions that day */
  avgFlowScore: number;
  flowLabel: 'deep' | 'moderate' | 'shallow' | 'fragmented';
  sessions: FlowSession[];
}

export interface FlowStateData {
  days: FlowDay[];
  overallFlowScore: number;
  avgFollowUpSec: number;
  avgBlockMin: number;
  deepFlowDays: number;
  totalDays: number;
  /** Weekly trend: labels + avg flow scores */
  weeklyTrend: { labels: string[]; scores: number[] };
  /** Per-hour flow score distribution (24 slots) — best hours for deep work */
  hourlyFlow: number[];
  /** Top suggestions */
  suggestions: string[];
}
