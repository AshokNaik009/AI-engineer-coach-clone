import { statSync, readdirSync } from 'fs';
import { join } from 'path';

const DIST_BUDGET_MB = 2;
const VSIX_BUDGET_MB = 5;

const distPath = join(import.meta.dirname, '..', 'dist', 'extension.js');
try {
  const size = statSync(distPath).size;
  const mb = size / (1024 * 1024);
  console.log(`dist/extension.js: ${mb.toFixed(2)} MB`);
  if (mb > DIST_BUDGET_MB) {
    console.error(`❌ Bundle exceeds ${DIST_BUDGET_MB}MB budget!`);
    process.exit(1);
  }
  console.log(`✅ Within ${DIST_BUDGET_MB}MB budget`);
} catch (e) {
  console.error('Could not check dist/extension.js — run npm run build first');
  process.exit(1);
}

// Check .vsix if present
const vsixFiles = readdirSync(join(import.meta.dirname, '..')).filter(f => f.endsWith('.vsix'));
for (const vsix of vsixFiles) {
  const size = statSync(join(import.meta.dirname, '..', vsix)).size;
  const mb = size / (1024 * 1024);
  console.log(`${vsix}: ${mb.toFixed(2)} MB`);
  if (mb > VSIX_BUDGET_MB) {
    console.error(`❌ ${vsix} exceeds ${VSIX_BUDGET_MB}MB budget!`);
    process.exit(1);
  }
}
