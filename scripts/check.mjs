// ==========================================
// FILE: scripts/check.mjs
// ==========================================
/**
 * @fileoverview Cross-platform pre-push integrity checker.
 * Executes snapshot regression tests, verifies clean compilation,
 * and ensures committed distribution bundles are in sync with source.
 */
import { spawnSync } from 'node:child_process';

console.log('=== [1/3] Running Snapshot Regression Tests ===');
const testResult = spawnSync('node', ['scripts/snapshot-runner.mjs'], { stdio: 'inherit' });
if (testResult.status !== 0) {
    process.exit(testResult.status ?? 1);
}

console.log('\n=== [2/3] Building Distribution Bundle ===');
const buildResult = spawnSync('node', ['build.mjs'], { stdio: 'inherit' });
if (buildResult.status !== 0) {
    process.exit(buildResult.status ?? 1);
}

console.log('\n=== [3/3] Checking Distribution Consistency ===');
const diffResult = spawnSync('git', ['diff', '--exit-code', 'dist/'], { stdio: 'inherit' });
if (diffResult.status !== 0) {
    console.error('\n[FAIL] dist/ has uncommitted differences or is out-of-sync with source code!');
    console.error('Please commit the updated dist/ files before pushing.');
    process.exit(1);
}

console.log('\n[SUCCESS] All checks passed cleanly! Ready to push.\n');
