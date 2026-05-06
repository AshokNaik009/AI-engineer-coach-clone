/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* ---- Session Intent Classification ---- */
export type SessionIntent = 'Planning' | 'Implementation' | 'Debugging' | 'Review' | 'Exploration';

export const SESSION_INTENTS: SessionIntent[] = ['Planning', 'Implementation', 'Debugging', 'Review', 'Exploration'];

export const INTENT_COLORS: Record<SessionIntent, string> = {
  'Planning': '#58a6ff',
  'Implementation': '#3fb950',
  'Debugging': '#f85149',
  'Review': '#d29922',
  'Exploration': '#bc8cff',
};

/* ---- Learning Velocity ---- */
export interface LearningVelocityData {
  weeklyLanguages: { week: string; languages: string[]; newLanguages: string[] }[];
  totalLanguagesEncountered: number;
  totalNewLanguagesLearned: number;
  velocityTrend: { labels: string[]; newLanguages: number[]; cumulativeLanguages: number[] };
  topLanguages: { language: string; firstSeen: string; weekCount: number }[];
}

/* ---- Intent Classification ---- */
export interface IntentClassificationData {
  sessionIntents: { sessionId: string; workspaceName: string; intent: SessionIntent; requestCount: number; date: string }[];
  distribution: Record<SessionIntent, number>;
  weeklyDistribution: { labels: string[]; series: Record<SessionIntent, number[]> };
  avgRequestsByIntent: Record<SessionIntent, number>;
}

/* ---- Spec-Driven Flag ---- */
export interface SpecDrivenData {
  totalSessions: number;
  specDrivenCount: number;
  specDrivenRate: number;
  weeklyTrend: { labels: string[]; specDriven: number[]; unstructured: number[] };
  unstructuredExamples: { workspaceName: string; firstPrompt: string; date: string }[];
}

/* ---- Production vs Review Ratio ---- */
export interface ProductionReviewData {
  totalAiLoc: number;
  estimatedReviewedLoc: number;
  reviewRatio: number;
  weeklyTrend: { labels: string[]; produced: number[]; estimated_reviewed: number[] };
  sessionsWithoutReview: number;
  avgReviewGapSec: number;
}

/* ---- Sustainable Pace ---- */
export interface SustainablePaceData {
  weeklyTrend: {
    labels: string[];
    lateNightReqs: number[];
    weekendReqs: number[];
    totalReqs: number[];
    avgSessionLength: number[];
  };
  burnoutRisk: 'low' | 'medium' | 'high';
  alerts: string[];
  currentStreak: number;
  weekendTrending: 'stable' | 'increasing' | 'decreasing';
  lateNightTrending: 'stable' | 'increasing' | 'decreasing';
}

/* ---- Prompt Engineering Maturity ---- */
export interface PromptMaturityData {
  overallGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  score: number;
  dimensions: {
    constraints: number;
    successCriteria: number;
    verificationSteps: number;
    contextProvision: number;
    specificity: number;
  };
  weeklyTrend: { labels: string[]; scores: number[] };
  samplePrompts: { text: string; grade: string; issues: string[] }[];
}

/* ---- Migration Readiness ---- */
export interface MigrationReadinessData {
  primaryHarness: string;
  missingFeatures: { feature: string; availableIn: string[]; description: string }[];
  readinessScore: number;
  featureUsage: { feature: string; used: boolean; harnesses: string[] }[];
}

/* ---- Insights aggregate ---- */
export interface InsightsData {
  learningVelocity: LearningVelocityData;
  intentClassification: IntentClassificationData;
  specDriven: SpecDrivenData;
  productionReview: ProductionReviewData;
  sustainablePace: SustainablePaceData;
  promptMaturity: PromptMaturityData;
  migrationReadiness: MigrationReadinessData;
}
