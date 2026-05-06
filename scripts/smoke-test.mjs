#!/usr/bin/env node
/**
 * Pre-publish smoke test: verifies the .vsix package is valid and the
 * extension can be loaded.
 */
import { execSync } from 'child_process';
import { existsSync, statSync, readFileSync } from 'fs';
import { join } from 'path';

const root = join(import.meta.dirname, '..');

// 1. Build
console.log('Building extension...');
execSync('npm run build', { cwd: root, stdio: 'inherit' });

// 2. Check dist exists
const distPath = join(root, 'dist', 'extension.js');
if (!existsSync(distPath)) {
  console.error('❌ dist/extension.js not found');
  process.exit(1);
}
console.log(`✅ dist/extension.js exists (${(statSync(distPath).size / 1024).toFixed(0)} KB)`);

// 3. Verify the extension module can be required (basic syntax check)
try {
  const mod = await import(`file://${distPath}`);
  if (typeof mod.activate !== 'function') {
    console.error('❌ extension.js does not export activate()');
    process.exit(1);
  }
  console.log('✅ extension.js exports activate()');
} catch (e) {
  console.error('❌ extension.js failed to load:', e.message);
  process.exit(1);
}

// 4. Check package.json is valid
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (!pkg.name || !pkg.version || !pkg.main) {
  console.error('❌ package.json missing required fields');
  process.exit(1);
}
console.log(`✅ package.json valid: ${pkg.name}@${pkg.version}`);

// 5. Verify no obvious issues with the contributes section
if (!pkg.contributes?.commands?.length) {
  console.error('❌ No commands registered');
  process.exit(1);
}
console.log(`✅ ${pkg.contributes.commands.length} commands registered`);

// 6. Verify activationEvents are set
if (!pkg.activationEvents?.length) {
  console.error('❌ No activationEvents — extension activates on every launch');
  process.exit(1);
}
console.log(`✅ ${pkg.activationEvents.length} activation events configured`);

console.log('\n🎉 Smoke test passed!');
