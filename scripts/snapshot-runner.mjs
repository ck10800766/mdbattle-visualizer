// ==========================================
// FILE: scripts/snapshot-runner.mjs
// ==========================================
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

import { engineState, createEmptyCombo } from '../src/state.js';
import { parseParticipants, buildStateSnapshots, getConsolidatedStats } from '../src/parser.js';
import { lookaheadComboState, advanceComboState } from '../src/choreography.js';
import { formatLogMessage } from '../src/utils.js';
import { extractTimelineMarkers } from '../src/timeline.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURES_DIR = path.resolve(__dirname, '../tests/fixtures');
const SNAPSHOTS_DIR = path.resolve(__dirname, '../tests/snapshots');

/**
 * Recursively converts ES6 Maps and Sets into deterministic plain objects/arrays
 * so state snapshots can be serialized to JSON and compared via deepStrictEqual.
 * @param {*} value - Input value to normalize.
 * @returns {*} Plain serializable representation.
 */
function toSerializable(value) {
    if (value === undefined) return '__UNDEFINED__';
    if (value === null || typeof value !== 'object') return value;

    if (value instanceof Map) {
        const obj = {};
        // Sort keys deterministically to prevent insertion-order false positives
        const sortedEntries = Array.from(value.entries()).sort(([a], [b]) =>
            String(a).localeCompare(String(b))
        );
        for (const [k, v] of sortedEntries) {
            obj[String(k)] = toSerializable(v);
        }
        return obj;
    }

    if (value instanceof Set) {
        return Array.from(value).map(toSerializable);
    }

    if (Array.isArray(value)) {
        return value.map(toSerializable);
    }

    const result = {};
    for (const key of Object.keys(value).sort()) {
        result[key] = toSerializable(value[key]);
    }
    return result;
}

/**
 * Simulates the runtime combo state progression across frames so that
 * lookaheadComboState (which reads engineState.currentCombo for DIRECT procs)
 * is tested under realistic playback conditions.
 * @param {Array<object>} frames - Parsed combat frames.
 * @returns {Array<object>} Array of lookahead results and formatted log HTML per frame.
 */
function simulateRuntimeTrace(frames) {
    engineState.currentCombo = createEmptyCombo();
    const trace = [];

    frames.forEach((frame, idx) => {
        const lookahead = lookaheadComboState(idx, frame);
        advanceComboState(frame, lookahead.isNextFrameSameCombo);

        trace.push({
            index: frame.index,
            lookahead,
            formattedHtml: frame.message ? formatLogMessage(frame.message, engineState.actors) : ''
        });
    });

    return trace;
}

/**
 * Executes the full headless engine pipeline on a raw battle report payload
 * and returns a deterministic, serializable snapshot object.
 * @param {object} rawReport - Raw battle report JSON payload.
 * @returns {object} Complete engine state snapshot.
 */
function generateEngineSnapshot(rawReport) {
    // Support both unwrapped report payloads and API responses wrapped in { data: ... }
    const reportData = rawReport.logs ? rawReport : (rawReport.data || rawReport);

    engineState.frames = [];
    engineState.actors.clear();
    engineState.currentFrameIndex = 0;
    engineState.currentCombo = createEmptyCombo();
    engineState.totalTurns = 0;
    engineState.battleResult = reportData.result || 'WIN';

    parseParticipants(reportData);
    buildStateSnapshots(reportData.logs || []);

    const mvpStats = getConsolidatedStats();
    const runtimeTrace = simulateRuntimeTrace(engineState.frames);
    const timelineMarkers = extractTimelineMarkers(engineState.frames);

    return toSerializable({
        battleResult: engineState.battleResult,
        totalTurns: engineState.totalTurns,
        actors: engineState.actors,
        mvpSummary: {
            mvpId: mvpStats.mvp ? mvpStats.mvp.id : null,
            mvpName: mvpStats.mvp ? mvpStats.mvp.name : null,
            maxTotalDamage: mvpStats.maxTotalDamage,
            consolidated: Array.from(mvpStats.consolidated.entries()).map(([actorId, stat]) => ({
                actorId,
                actorName: stat.actor.name,
                totalOutput: stat.totalOutput,
                totalTaken: stat.totalTaken
            }))
        },
        timelineMarkers,
        frames: engineState.frames,
        runtimeTrace
    });
}

/**
 * Locates the first mismatching frame or property path between two snapshots
 * to provide concise, readable error diagnostics instead of a 10,000-line dump.
 * @param {object} actual - Newly generated snapshot.
 * @param {object} expected - Stored golden snapshot.
 */
function reportDetailedDiff(actual, expected) {
    for (const topKey of ['battleResult', 'totalTurns', 'actors', 'mvpSummary', 'timelineMarkers']) {
        if (!isDeepStrictEqual(actual[topKey], expected[topKey])) {
            console.error(`  -> Mismatch in top-level section: [${topKey}]`);
            assert.deepStrictEqual(actual[topKey], expected[topKey]);
        }
    }

    if (actual.frames.length !== expected.frames.length) {
        console.error(`  -> Frame count mismatch: actual=${actual.frames.length}, expected=${expected.frames.length}`);
        assert.strictEqual(actual.frames.length, expected.frames.length);
    }

    for (let i = 0; i < actual.frames.length; i++) {
        if (!isDeepStrictEqual(actual.frames[i], expected.frames[i])) {
            console.error(`  -> Mismatch detected at frames[${i}] (type: ${actual.frames[i]?.type}):`);
            assert.deepStrictEqual(actual.frames[i], expected.frames[i]);
        }
    }

    for (let i = 0; i < actual.runtimeTrace.length; i++) {
        if (!isDeepStrictEqual(actual.runtimeTrace[i], expected.runtimeTrace[i])) {
            console.error(`  -> Mismatch detected at runtimeTrace[${i}]:`);
            assert.deepStrictEqual(actual.runtimeTrace[i], expected.runtimeTrace[i]);
        }
    }
}

/**
 * Main CLI entry point.
 * Usage:
 *   node scripts/snapshot-runner.mjs --update   (Record/update golden snapshots)
 *   node scripts/snapshot-runner.mjs            (Verify current code against golden snapshots)
 */
function main() {
    const isUpdateMode = process.argv.includes('--update') || process.argv.includes('-u');

    fs.mkdirSync(FIXTURES_DIR, { recursive: true });
    fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });

    const fixtureFiles = fs.readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.json'));

    if (fixtureFiles.length === 0) {
        console.warn(`[WARN] No battle report JSON files found in: ${FIXTURES_DIR}`);
        console.warn('Please save at least one battle report JSON (e.g., report-patriot.json) into tests/fixtures/.');
        process.exit(0);
    }

    let passed = 0;
    let failed = 0;

    for (const file of fixtureFiles) {
        const fixturePath = path.join(FIXTURES_DIR, file);
        const snapshotPath = path.join(SNAPSHOTS_DIR, `${file}.snap.json`);

        const rawReport = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
        const currentSnapshot = generateEngineSnapshot(rawReport);

        if (isUpdateMode || !fs.existsSync(snapshotPath)) {
            fs.writeFileSync(snapshotPath, JSON.stringify(currentSnapshot, null, 2), 'utf8');
            console.log(`[UPDATED] Golden snapshot saved: tests/snapshots/${file}.snap.json`);
            passed++;
            continue;
        }

        const expectedSnapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));

        try {
            if (!isDeepStrictEqual(currentSnapshot, expectedSnapshot)) {
                console.error(`\n[FAIL] ${file} diverged from golden snapshot!`);
                reportDetailedDiff(currentSnapshot, expectedSnapshot);
            } else {
                console.log(`[PASS] ${file} (${currentSnapshot.frames.length} frames, ${currentSnapshot.totalTurns} turns, ${currentSnapshot.timelineMarkers?.length || 0} milestone pins verified)`);
                passed++;
            }
        } catch (err) {
            console.error(err.message);
            failed++;
        }
    }

    console.log(`\nSnapshot Summary: ${passed} passed, ${failed} failed.`);
    if (failed > 0) process.exit(1);
}

main();