/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Lexer for the metric expression DSL.
 * Converts a source string into a list of tokens.
 */

import { Token, TokenType } from './types';

const KEYWORDS: Record<string, TokenType> = {
  and: TokenType.AND,
  or: TokenType.OR,
  not: TokenType.NOT,
  true: TokenType.BOOLEAN,
  false: TokenType.BOOLEAN,
  AND: TokenType.AND,
  OR: TokenType.OR,
  NOT: TokenType.NOT,
  TRUE: TokenType.BOOLEAN,
  FALSE: TokenType.BOOLEAN,
};

const TWO_CHAR_TOKENS: Record<string, TokenType> = {
  '<=': TokenType.LTE,
  '>=': TokenType.GTE,
  '==': TokenType.EQ,
  '!=': TokenType.NEQ,
};

const SINGLE_CHAR_TOKENS: Record<string, TokenType> = {
  '<': TokenType.LT,
  '>': TokenType.GT,
  '(': TokenType.LPAREN,
  ')': TokenType.RPAREN,
  '[': TokenType.LBRACKET,
  ']': TokenType.RBRACKET,
  '.': TokenType.DOT,
  ',': TokenType.COMMA,
  '|': TokenType.PIPE,
  ':': TokenType.COLON,
  '+': TokenType.PLUS,
  '*': TokenType.STAR,
};

const REGEX_FLAG_RE = /[gimsuy]/;

export class LexerError extends Error {
  constructor(message: string, public pos: number) {
    super(`Lexer error at position ${pos}: ${message}`);
  }
}

interface ScanResult {
  token: Token;
  nextIndex: number;
}

export function lex(input: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < input.length) {
    index = skipWhitespace(input, index);
    if (index >= input.length) break;

    const prevToken = tokens[tokens.length - 1];
    const token =
      readTwoCharToken(input, index) ??
      readSingleCharToken(input, index) ??
      readSlashToken(input, index, prevToken) ??
      readMinusToken(input, index, prevToken) ??
      readNumberToken(input, index) ??
      readQuotedStringToken(input, index) ??
      readIdentifierToken(input, index);

    if (!token) {
      throw new LexerError(`Unexpected character '${input[index]}'`, index);
    }

    tokens.push(token.token);
    index = token.nextIndex;
  }

  tokens.push({ type: TokenType.EOF, value: '', pos: input.length });
  return tokens;
}

function skipWhitespace(input: string, start: number): number {
  let index = start;
  while (index < input.length && isWhitespace(input[index])) index++;
  return index;
}

function isWhitespace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\r' || char === '\n';
}

function createToken(type: TokenType, value: string, pos: number, nextIndex: number): ScanResult {
  return { token: { type, value, pos }, nextIndex };
}

function readTwoCharToken(input: string, index: number): ScanResult | null {
  const type = TWO_CHAR_TOKENS[input.slice(index, index + 2)];
  return type === undefined ? null : createToken(type, input.slice(index, index + 2), index, index + 2);
}

function readSingleCharToken(input: string, index: number): ScanResult | null {
  const char = input[index];
  const type = SINGLE_CHAR_TOKENS[char];
  return type === undefined ? null : createToken(type, char, index, index + 1);
}

function isDivisionContext(token: Token | undefined): boolean {
  return token?.type === TokenType.NUMBER ||
    token?.type === TokenType.IDENTIFIER ||
    token?.type === TokenType.RPAREN ||
    token?.type === TokenType.RBRACKET;
}

function readSlashToken(input: string, index: number, prevToken: Token | undefined): ScanResult | null {
  if (input[index] !== '/') return null;
  if (isDivisionContext(prevToken)) {
    return createToken(TokenType.SLASH, '/', index, index + 1);
  }
  return readRegexToken(input, index);
}

function isUnaryMinusContext(token: Token | undefined): boolean {
  return token === undefined ||
    token.type === TokenType.LPAREN ||
    token.type === TokenType.COMMA ||
    token.type === TokenType.LT ||
    token.type === TokenType.GT ||
    token.type === TokenType.LTE ||
    token.type === TokenType.GTE ||
    token.type === TokenType.EQ ||
    token.type === TokenType.NEQ ||
    token.type === TokenType.AND ||
    token.type === TokenType.OR ||
    token.type === TokenType.NOT ||
    token.type === TokenType.PLUS ||
    token.type === TokenType.MINUS ||
    token.type === TokenType.STAR ||
    token.type === TokenType.SLASH;
}

function readMinusToken(input: string, index: number, prevToken: Token | undefined): ScanResult | null {
  if (input[index] !== '-') return null;
  if (isUnaryMinusContext(prevToken) && isDigit(input[index + 1] ?? '')) {
    return readNumberToken(input, index, true);
  }
  return createToken(TokenType.MINUS, '-', index, index + 1);
}

function readNumberToken(input: string, index: number, allowLeadingMinus = false): ScanResult | null {
  const firstChar = input[index];
  if (!isDigit(firstChar) && !(allowLeadingMinus && firstChar === '-')) return null;
  let nextIndex = index + 1;
  while (nextIndex < input.length && (isDigit(input[nextIndex]) || input[nextIndex] === '.')) {
    nextIndex++;
  }
  return createToken(TokenType.NUMBER, input.slice(index, nextIndex), index, nextIndex);
}

function readQuotedStringToken(input: string, index: number): ScanResult | null {
  const quote = input[index];
  if (quote !== '"' && quote !== "'") return null;
  let nextIndex = index + 1;
  let value = '';
  while (nextIndex < input.length && input[nextIndex] !== quote) {
    if (input[nextIndex] === '\\' && nextIndex + 1 < input.length) nextIndex++;
    value += input[nextIndex];
    nextIndex++;
  }
  if (nextIndex < input.length) nextIndex++;
  return createToken(TokenType.STRING, value, index, nextIndex);
}

function readRegexToken(input: string, index: number): ScanResult {
  let nextIndex = index + 1;
  let pattern = '';
  while (nextIndex < input.length && input[nextIndex] !== '/') {
    if (input[nextIndex] === '\\' && nextIndex + 1 < input.length) {
      pattern += input[nextIndex];
      nextIndex++;
    }
    pattern += input[nextIndex];
    nextIndex++;
  }
  if (nextIndex < input.length) nextIndex++;
  const flagsStart = nextIndex;
  while (nextIndex < input.length && REGEX_FLAG_RE.test(input[nextIndex])) nextIndex++;
  const flags = input.slice(flagsStart, nextIndex);
  return createToken(TokenType.STRING, `/${pattern}/${flags}`, index, nextIndex);
}

function readIdentifierToken(input: string, index: number): ScanResult | null {
  if (!isIdentStart(input[index])) return null;
  let nextIndex = index + 1;
  while (nextIndex < input.length && isIdentPart(input[nextIndex])) nextIndex++;
  const value = input.slice(index, nextIndex);
  return createToken(KEYWORDS[value] ?? TokenType.IDENTIFIER, value, index, nextIndex);
}

function isDigit(c: string): boolean {
  return c >= '0' && c <= '9';
}

function isIdentStart(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
}

function isIdentPart(c: string): boolean {
  return isIdentStart(c) || isDigit(c);
}
