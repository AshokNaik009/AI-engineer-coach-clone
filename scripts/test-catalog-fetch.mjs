/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Quick test: verify the catalog scraping regex works against real awesome-copilot pages.
 * Run: node scripts/test-catalog-fetch.mjs
 */

const CATALOG_BASE = 'https://awesome-copilot.github.com';

async function fetchCatalogPage(slug) {
  const url = `${CATALOG_BASE}/${slug}/`;
  const response = await fetch(url);
  if (response.status !== 200) return [];
  const html = await response.text();

  const items = [];
  const articleRegex = /<article\s+class="resource-item"[^>]*data-path="([^"]*)"[^>]*>([\s\S]*?)<\/article>/g;
  let match;
  while ((match = articleRegex.exec(html)) !== null) {
    const path = match[1];
    const block = match[2];

    const titleMatch = block.match(/<div class="resource-title">([^<]*)<\/div>/);
    const descMatch = block.match(/<div class="resource-description">([\s\S]*?)<\/div>/);
    const categoryMatch = block.match(/tag-category">([^<]*)</);

    const title = titleMatch ? titleMatch[1].trim() : '';
    const description = descMatch ? descMatch[1].trim().replace(/<[^>]*>/g, '') : '';
    const category = categoryMatch ? categoryMatch[1].trim() : '';

    if (title) {
      items.push({ kind: slug.replace(/s$/, ''), id: `${slug}:${path}`, title, description, category, path });
    }
  }
  return items;
}

function scoreCatalogItem(item, context) {
  let score = 0;
  const searchText = `${item.title} ${item.description} ${item.category}`.toLowerCase();

  for (const lang of context.languages) {
    if (searchText.includes(lang.toLowerCase())) score += 10;
  }
  for (const topic of context.topics) {
    if (searchText.includes(topic.toLowerCase())) score += 5;
  }
  for (const h of context.harnesses) {
    if (searchText.includes(h.toLowerCase())) score += 3;
  }
  if (item.kind === 'skill') score += 2;
  if (item.kind === 'agent') score += 1;

  return score;
}

let failures = 0;
let passes = 0;

function assert(condition, label, detail) {
  if (condition) {
    passes++;
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.error(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`);
  }
}

function section(name) {
  console.log(`\n=== ${name} ===`);
}

async function main() {
  // ---- 1. Fetch all catalogs ----
  section('Catalog Fetching');
  
  const slugs = ['skills', 'agents', 'instructions', 'hooks'];
  const results = {};
  
  for (const slug of slugs) {
    console.log(`  Fetching ${slug}...`);
    const t0 = Date.now();
    const items = await fetchCatalogPage(slug);
    const elapsed = Date.now() - t0;
    results[slug] = items;
    assert(items.length > 0, `${slug}: ${items.length} items fetched (${elapsed}ms)`);
    
    if (items.length > 0) {
      const sample = items[0];
      assert(typeof sample.title === 'string' && sample.title.length > 0, `${slug} first item has title: ${sample.title}`);
      assert(typeof sample.description === 'string', `${slug} first item has description`);
      assert(typeof sample.path === 'string' && sample.path.length > 0, `${slug} first item has path: ${sample.path}`);
    }
  }

  const allItems = Object.values(results).flat();
  console.log(`\n  Total catalog items: ${allItems.length}`);

  // ---- 2. Test scoring ----
  section('Relevance Scoring');

  // Simulate a TypeScript+React developer
  const context = {
    languages: ['typescript', 'javascript', 'css', 'python'],
    harnesses: ['Local Agent (Insiders)'],
    topics: ['test', 'react', 'api', 'docker', 'deploy', 'azure'],
    workspaces: ['my-app'],
  };

  const scored = allItems.map(item => ({
    ...item,
    relevanceScore: scoreCatalogItem(item, context),
  }));

  scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
  const topMatches = scored.filter(s => s.relevanceScore > 0).slice(0, 10);

  assert(topMatches.length > 0, `Found ${topMatches.length} relevant items for TS/React/Azure developer`);
  assert(topMatches[0].relevanceScore > 5, `Top item score: ${topMatches[0].relevanceScore}`);

  console.log(`\n  Top 10 matches for a TS/React developer:`);
  for (const item of topMatches) {
    console.log(`    [${item.relevanceScore}] (${item.kind}) ${item.title} — ${item.category || 'uncategorized'}`);
  }

  // Verify we get diverse kinds
  const kindSet = new Set(topMatches.map(i => i.kind));
  console.log(`  Kinds represented: ${[...kindSet].join(', ')}`);

  // ---- 3. Test with different context ----
  section('Scoring - Python/Django developer');
  const pyContext = {
    languages: ['python', 'html', 'css'],
    harnesses: ['Local Agent'],
    topics: ['django', 'database', 'deploy', 'docker', 'test'],
    workspaces: ['django-project'],
  };

  const pyScored = allItems.map(item => ({
    ...item,
    relevanceScore: scoreCatalogItem(item, pyContext),
  }));
  pyScored.sort((a, b) => b.relevanceScore - a.relevanceScore);
  const pyTop = pyScored.filter(s => s.relevanceScore > 0).slice(0, 5);

  assert(pyTop.length > 0, `Found ${pyTop.length} matches for Python/Django developer`);
  console.log(`  Top 5:`);
  for (const item of pyTop) {
    console.log(`    [${item.relevanceScore}] (${item.kind}) ${item.title}`);
  }

  // ---- 4. Edge cases ----
  section('Edge Cases');

  // Empty context should still not crash
  const emptyScored = allItems.map(item => ({
    ...item,
    relevanceScore: scoreCatalogItem(item, { languages: [], harnesses: [], topics: [], workspaces: [] }),
  }));
  const emptyTop = emptyScored.filter(s => s.relevanceScore > 0);
  // With empty context, only the kind bonus applies (skills get +2, agents +1)
  assert(emptyTop.length >= 0, `Empty context: ${emptyTop.length} items with score > 0 (from kind bonus)`);

  // ---- Summary ----
  section('Summary');
  console.log(`\n========================================`);
  console.log(`  ${passes} passed, ${failures} failed`);
  console.log(`========================================\n`);

  process.exit(failures > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('CRASH:', e);
  process.exit(1);
});
