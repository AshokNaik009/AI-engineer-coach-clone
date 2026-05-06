/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Shared state and progression helpers for the learning page. */

import { vscode } from './shared';

export interface ConceptDef {
  id: string;
  name: string;
  tier: number;
  prereqs: string[];
  desc: string;
}

export const DEFAULT_CONCEPTS: ConceptDef[] = [
  { id: 'syntax',       name: 'Syntax & Idioms',       tier: 0, prereqs: [],                          desc: 'Core syntax, naming conventions, idiomatic patterns' },
  { id: 'data-structs', name: 'Data Structures',        tier: 0, prereqs: [],                          desc: 'Built-in collections, arrays, maps, sets, standard library types' },
  { id: 'control-flow', name: 'Control Flow',           tier: 0, prereqs: [],                          desc: 'Conditionals, loops, iterators, switches, pattern matching' },
  { id: 'error-handling', name: 'Error Handling',       tier: 1, prereqs: ['control-flow'],            desc: 'Exceptions, Result/Option types, error propagation strategies' },
  { id: 'type-system',    name: 'Type System',          tier: 1, prereqs: ['syntax'],                  desc: 'Types, interfaces, traits, type inference, type guards' },
  { id: 'modules',        name: 'Modules & Packages',   tier: 1, prereqs: ['syntax'],                  desc: 'Module system, package management, import/export, namespaces' },
  { id: 'async',     name: 'Async & Concurrency',       tier: 2, prereqs: ['error-handling'],          desc: 'Promises, async/await, threads, channels, parallelism' },
  { id: 'generics',  name: 'Generics & Metaprogramming', tier: 2, prereqs: ['type-system'],            desc: 'Generic types, macros, decorators, reflection' },
  { id: 'testing',   name: 'Testing & QA',              tier: 2, prereqs: ['modules'],                 desc: 'Unit/integration tests, mocking, coverage' },
  { id: 'performance', name: 'Performance',             tier: 3, prereqs: ['async', 'data-structs'],   desc: 'Profiling, optimization, memory management' },
  { id: 'patterns',    name: 'Design Patterns',         tier: 3, prereqs: ['type-system', 'modules'],  desc: 'GoF patterns, SOLID principles' },
  { id: 'security',    name: 'Security',                tier: 3, prereqs: ['error-handling', 'modules'], desc: 'Input validation, auth, OWASP' },
  { id: 'architecture', name: 'System Architecture',    tier: 4, prereqs: ['patterns', 'async'],       desc: 'Large-scale design, distributed systems, API design' },
  { id: 'internals',    name: 'Language Internals',     tier: 4, prereqs: ['performance', 'generics'], desc: 'Runtime internals, FFI, memory model' },
];

export const EXCLUDED_LANGS = new Set(['unknown', 'other', 'text', 'plaintext', 'binary']);

const LANG_ALIASES: Record<string, string> = {
  py: 'Python', python: 'Python',
  js: 'JavaScript', javascript: 'JavaScript',
  ts: 'TypeScript', typescript: 'TypeScript',
  rb: 'Ruby', ruby: 'Ruby',
  cs: 'C#', csharp: 'C#',
  cpp: 'C++',
  rs: 'Rust', rust: 'Rust',
  go: 'Go', golang: 'Go',
  kt: 'Kotlin', kotlin: 'Kotlin',
  sh: 'Shell', bash: 'Shell', zsh: 'Shell',
  yml: 'YAML', yaml: 'YAML',
};

export function normalizeLang(label: string): string {
  return LANG_ALIASES[label.toLowerCase()] ?? label;
}

export function mergeLanguages(raw: { label: string; loc: number }[]): { label: string; loc: number }[] {
  const merged = new Map<string, { label: string; loc: number }>();
  for (const entry of raw) {
    const canonical = normalizeLang(entry.label);
    const existing = merged.get(canonical);
    if (existing) {
      existing.loc += entry.loc;
    } else {
      merged.set(canonical, { label: canonical, loc: entry.loc });
    }
  }
  return [...merged.values()];
}

export interface QuizQuestion {
  question: string;
  choices: string[];
  correctIndex: number;
  explanation: string;
  difficulty: 'easy' | 'medium' | 'hard';
  topic: string;
}

export interface ConceptProgress {
  passed: number;
  failed: number;
}

export interface CachedResource {
  title: string;
  url: string;
  type: string;
  reason: string;
}

export interface CodeComparisonRound {
  snippetA: string;
  snippetB: string;
  betterSnippet: 'A' | 'B';
  title: string;
  category: string;
  explanation: string;
  difficulty: string;
  language: string;
}

export interface DidYouKnowFact {
  fact: string;
  project: string;
  category: string;
}

export interface LearningPathEntry {
  lang: string;
  conceptId: string;
}

export interface LearningState {
  solved: number;
  failed: number;
  streak: number;
  bestStreak: number;
  solvedSamples: string[];
  failedSamples: string[];
  currentDifficulty: 'easy' | 'medium' | 'hard';
  snakeUnlocked: boolean;
  snakeHighScore: number;
  totalQuizTimeMs: number;
  quizCount: number;
  selectedLanguage: string | null;
  focusedConcepts: string[];
  learningPath: LearningPathEntry[];
  langProgress: Record<string, Record<string, ConceptProgress>>;
  cachedQuizzes: QuizQuestion[];
  cachedQuizKey: string;
  cachedResources: CachedResource[];
  cachedResourceKey: string;
  cachedSkillTrees: Record<string, ConceptDef[]>;
  cachedCodeReview: CodeComparisonRound[];
  cachedCodeReviewKey: string;
  codeReviewCorrect: number;
  codeReviewTotal: number;
  codeReviewSeenTopics: string[];
  cachedDidYouKnow: DidYouKnowFact[];
  cachedDidYouKnowKey: string;
  didYouKnowSeenFacts: string[];
  selectedProjects: string[];
}

const DEFAULT_LEARNING_STATE: LearningState = {
  solved: 0,
  failed: 0,
  streak: 0,
  bestStreak: 0,
  solvedSamples: [],
  failedSamples: [],
  currentDifficulty: 'medium',
  snakeUnlocked: false,
  snakeHighScore: 0,
  totalQuizTimeMs: 0,
  quizCount: 0,
  selectedLanguage: null,
  focusedConcepts: [],
  learningPath: [],
  langProgress: {},
  cachedQuizzes: [],
  cachedQuizKey: '',
  cachedResources: [],
  cachedResourceKey: '',
  cachedSkillTrees: {},
  cachedCodeReview: [],
  cachedCodeReviewKey: '',
  codeReviewCorrect: 0,
  codeReviewTotal: 0,
  codeReviewSeenTopics: [],
  cachedDidYouKnow: [],
  cachedDidYouKnowKey: '',
  didYouKnowSeenFacts: [],
  selectedProjects: [],
};

export function getState(): LearningState {
  const s = vscode.getState() as Record<string, unknown> | null;
  const ls = (s?.learningState ?? {}) as Partial<LearningState>;
  return {
    ...DEFAULT_LEARNING_STATE,
    ...ls,
    solvedSamples: [...(ls.solvedSamples ?? DEFAULT_LEARNING_STATE.solvedSamples)],
    failedSamples: [...(ls.failedSamples ?? DEFAULT_LEARNING_STATE.failedSamples)],
    focusedConcepts: [...(ls.focusedConcepts ?? DEFAULT_LEARNING_STATE.focusedConcepts)],
    learningPath: [...(ls.learningPath ?? DEFAULT_LEARNING_STATE.learningPath)],
    langProgress: { ...(ls.langProgress ?? DEFAULT_LEARNING_STATE.langProgress) },
    cachedQuizzes: [...(ls.cachedQuizzes ?? DEFAULT_LEARNING_STATE.cachedQuizzes)],
    cachedResources: [...(ls.cachedResources ?? DEFAULT_LEARNING_STATE.cachedResources)],
    cachedSkillTrees: { ...(ls.cachedSkillTrees ?? DEFAULT_LEARNING_STATE.cachedSkillTrees) },
    cachedCodeReview: [...(ls.cachedCodeReview ?? DEFAULT_LEARNING_STATE.cachedCodeReview)],
    codeReviewSeenTopics: [...(ls.codeReviewSeenTopics ?? DEFAULT_LEARNING_STATE.codeReviewSeenTopics)],
    cachedDidYouKnow: [...(ls.cachedDidYouKnow ?? DEFAULT_LEARNING_STATE.cachedDidYouKnow)],
    didYouKnowSeenFacts: [...(ls.didYouKnowSeenFacts ?? DEFAULT_LEARNING_STATE.didYouKnowSeenFacts)],
    selectedProjects: [...(ls.selectedProjects ?? DEFAULT_LEARNING_STATE.selectedProjects)],
  };
}

export function saveState(ls: LearningState): void {
  const s = (vscode.getState() as Record<string, unknown>) ?? {};
  vscode.setState({ ...s, learningState: ls });
}

export function isInLearningPath(state: LearningState, lang: string, conceptId: string): boolean {
  return state.learningPath.some(e => e.lang === lang && e.conceptId === conceptId);
}

export function addToLearningPath(state: LearningState, lang: string, conceptId: string): void {
  if (state.learningPath.length >= 15) return;
  if (!isInLearningPath(state, lang, conceptId)) {
    state.learningPath.push({ lang, conceptId });
    if (!state.focusedConcepts.includes(conceptId)) state.focusedConcepts.push(conceptId);
  }
}

export function removeFromLearningPath(state: LearningState, lang: string, conceptId: string): void {
  state.learningPath = state.learningPath.filter(e => !(e.lang === lang && e.conceptId === conceptId));
  state.focusedConcepts = [...new Set(state.learningPath.map(e => e.conceptId))];
}

export function clearLearningPath(state: LearningState): void {
  state.learningPath = [];
  state.focusedConcepts = [];
}

export function groupLearningPath(state: LearningState): Map<string, LearningPathEntry[]> {
  const groups = new Map<string, LearningPathEntry[]>();
  for (const entry of state.learningPath) {
    const arr = groups.get(entry.lang) ?? [];
    arr.push(entry);
    groups.set(entry.lang, arr);
  }
  return groups;
}

export function getConceptsForLang(lang: string, state: LearningState): ConceptDef[] {
  return state.cachedSkillTrees[lang] ?? DEFAULT_CONCEPTS;
}

export function findConcept(cid: string, state: LearningState, langHint?: string | null): ConceptDef | undefined {
  if (langHint) {
    const tree = getConceptsForLang(langHint, state);
    const found = tree.find(c => c.id === cid);
    if (found) return found;
  }
  for (const tree of Object.values(state.cachedSkillTrees)) {
    const found = tree.find(c => c.id === cid);
    if (found) return found;
  }
  return DEFAULT_CONCEPTS.find(c => c.id === cid);
}

export function quizCacheKey(langs: string[], focus: string[], difficulty: string, lang: string | null): string {
  return `q:${(lang ?? langs.join(','))}|${focus.join(',')}|${difficulty}`;
}

export function resourceCacheKey(langs: string[], gaps: string[], focus: string[]): string {
  return `r:${langs.join(',')}|${gaps.join(',')}|${focus.join(',')}`;
}

export function codeReviewCacheKey(langs: string[], difficulty: string): string {
  return `cr:${langs.join(',')}|${difficulty}`;
}

export function didYouKnowCacheKey(langs: string[], workspaces: string[]): string {
  return `dyk:${langs.join(',')}|${workspaces.join(',')}`;
}