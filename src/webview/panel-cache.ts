/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Analyzer } from '../core/analyzer';
import { ParseResult } from '../core/parser';

class PanelCache {
  private parseResult: ParseResult | undefined;
  private analyzer: Analyzer | undefined;

  get result(): ParseResult | undefined { return this.parseResult; }
  get analyzerInstance(): Analyzer | undefined { return this.analyzer; }

  store(result: ParseResult, analyzer: Analyzer): void {
    this.parseResult = result;
    this.analyzer = analyzer;
  }

  clear(): void {
    this.parseResult = undefined;
    this.analyzer = undefined;
  }
}

export const panelCache = new PanelCache();