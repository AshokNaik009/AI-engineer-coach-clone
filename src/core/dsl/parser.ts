/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Recursive-descent parser for the metric expression DSL.
 * Turns a token stream into an AST.
 *
 * Grammar (simplified):
 *   expr       := or_expr
 *   or_expr    := and_expr ('OR' and_expr)*
 *   and_expr   := not_expr ('AND' not_expr)*
 *   not_expr   := 'NOT' not_expr | comparison
 *   comparison := addition (('<'|'>'|'<='|'>='|'=='|'!=') addition)?
 *   addition   := unary (('+' | '-') unary)*
 *   unary      := pipe_expr
 *   pipe_expr  := primary ('|' IDENT (':' primary)?)*
 *   primary    := NUMBER | STRING | BOOLEAN | call_or_field | '(' expr ')' | '[' list ']'
 *   call_or_field := IDENT ('(' args ')' | ('.' IDENT)*)
 *   args       := expr (',' expr)*
 */

import { Token, TokenType, ASTNode } from './types';

export class ParseError extends Error {
  constructor(message: string, public pos: number) {
    super(`Parse error at position ${pos}: ${message}`);
  }
}

const MAX_PARSE_DEPTH = 64;

export function parse(tokens: Token[]): ASTNode {
  let pos = 0;
  let depth = 0;

  function peek(): Token { return tokens[pos]; }
  function advance(): Token { return tokens[pos++]; }
  function expect(type: TokenType): Token {
    const t = peek();
    if (t.type !== type) {
      throw new ParseError(`Expected ${TokenType[type]}, got ${TokenType[t.type]} '${t.value}'`, t.pos);
    }
    return advance();
  }
  function enter(): void {
    depth++;
    if (depth > MAX_PARSE_DEPTH) {
      throw new ParseError(`Expression too deeply nested (max depth ${MAX_PARSE_DEPTH})`, peek().pos);
    }
  }
  function exit(): void { depth--; }

  function parseExpr(): ASTNode {
    return parseOr();
  }

  function parseOr(): ASTNode {
    enter();
    try {
      let left = parseAnd();
      while (peek().type === TokenType.OR) {
        advance();
        const right = parseAnd();
        left = { type: 'binary', op: 'OR', left, right };
      }
      return left;
    } finally { exit(); }
  }

  function parseAnd(): ASTNode {
    enter();
    try {
      let left = parseNot();
      while (peek().type === TokenType.AND) {
        advance();
        const right = parseNot();
        left = { type: 'binary', op: 'AND', left, right };
      }
      return left;
    } finally { exit(); }
  }

  function parseNot(): ASTNode {
    enter();
    try {
      if (peek().type === TokenType.NOT) {
        advance();
        const operand = parseNot();
        return { type: 'unary', op: 'NOT', operand };
      }
      return parseComparison();
    } finally { exit(); }
  }

  function parseComparison(): ASTNode {
    enter();
    try {
      const left = parseAddition();
      const t = peek();
      if (t.type === TokenType.LT || t.type === TokenType.GT ||
          t.type === TokenType.LTE || t.type === TokenType.GTE ||
          t.type === TokenType.EQ || t.type === TokenType.NEQ) {
        const op = advance().value;
        const right = parseAddition();
        return { type: 'binary', op, left, right };
      }
      return left;
    } finally { exit(); }
  }

  function parseAddition(): ASTNode {
    enter();
    try {
      let left = parseMultiplication();
      while (peek().type === TokenType.PLUS || peek().type === TokenType.MINUS) {
        const op = advance().value;
        const right = parseMultiplication();
        left = { type: 'binary', op, left, right };
      }
      return left;
    } finally { exit(); }
  }

  function parseMultiplication(): ASTNode {
    enter();
    try {
      let left = parsePipe();
      while (peek().type === TokenType.STAR || peek().type === TokenType.SLASH) {
        const op = advance().value;
        const right = parsePipe();
        left = { type: 'binary', op, left, right };
      }
      return left;
    } finally { exit(); }
  }

  function parsePipe(): ASTNode {
    enter();
    try {
    let left = parsePrimary();
    while (peek().type === TokenType.PIPE) {
      advance();
      const filterName = expect(TokenType.IDENTIFIER).value;
      let arg: ASTNode | undefined;
      if (peek().type === TokenType.COLON) {
        advance();
        arg = parsePrimary();
      }
      left = { type: 'pipe', value: left, filter: filterName, arg };
    }
    return left;
    } finally { exit(); }
  }

  function parsePrimary(): ASTNode {
    enter();
    try {
    const t = peek();

    // Number
    if (t.type === TokenType.NUMBER) {
      advance();
      return { type: 'number', value: Number.parseFloat(t.value) };
    }

    // String
    if (t.type === TokenType.STRING) {
      advance();
      return { type: 'string', value: t.value };
    }

    // Boolean
    if (t.type === TokenType.BOOLEAN) {
      advance();
      return { type: 'boolean', value: t.value.toLowerCase() === 'true' };
    }

    // Array literal [a, b, c]
    if (t.type === TokenType.LBRACKET) {
      advance();
      const elements: ASTNode[] = [];
      if (peek().type !== TokenType.RBRACKET) {
        elements.push(parseExpr());
        while (peek().type === TokenType.COMMA) {
          advance();
          elements.push(parseExpr());
        }
      }
      expect(TokenType.RBRACKET);
      return { type: 'array', elements };
    }

    // Grouped expression
    if (t.type === TokenType.LPAREN) {
      advance();
      const inner = parseExpr();
      expect(TokenType.RPAREN);
      return inner;
    }

    // Identifier, field access, or function call
    if (t.type === TokenType.IDENTIFIER) {
      return parseCallOrField();
    }

    throw new ParseError(`Unexpected token '${t.value}'`, t.pos);
    } finally { exit(); }
  }

  function parseCallOrField(): ASTNode {
    const name = advance().value;

    // Function call: name(args)
    if (peek().type === TokenType.LPAREN) {
      advance();
      const args: ASTNode[] = [];
      if (peek().type !== TokenType.RPAREN) {
        args.push(parseExpr());
        while (peek().type === TokenType.COMMA) {
          advance();
          args.push(parseExpr());
        }
      }
      expect(TokenType.RPAREN);
      let result: ASTNode = { type: 'call', name, args };
      // Allow chaining: func().field
      while (peek().type === TokenType.DOT) {
        advance();
        const field = expect(TokenType.IDENTIFIER).value;
        result = { type: 'field_access', object: result, field };
      }
      return result;
    }

    // Field access: a.b.c
    let node: ASTNode = { type: 'identifier', name };
    while (peek().type === TokenType.DOT) {
      advance();
      const field = expect(TokenType.IDENTIFIER).value;
      node = { type: 'field_access', object: node, field };
    }
    return node;
  }

  const ast = parseExpr();
  if (peek().type !== TokenType.EOF) {
    throw new ParseError(`Unexpected trailing token '${peek().value}'`, peek().pos);
  }
  return ast;
}
