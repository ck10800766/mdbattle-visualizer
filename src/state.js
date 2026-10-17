// ==========================================
// FILE: src/state.js
// ==========================================
/**
 * @fileoverview Global mutable state store (`engineState`) and playback timing/token utilities.
 * Shared across both headless parsing modules and Shadow DOM rendering modules.
 */

import { PLAYBACK_SPEEDS, SPEED_STORAGE_KEY } from './constants.js';

/**
 * Reads the persisted playback speed from `localStorage` if available and valid.
 * Falls back to `1.0` in headless Node environments or when unset.
 * @returns {number} Initial playback speed multiplier.
 */
function loadSavedPlaybackSpeed() {
    try {
        if (typeof localStorage !== 'undefined') {
            const raw = Number(localStorage.getItem(SPEED_STORAGE_KEY));
            if (PLAYBACK_SPEEDS.includes(raw)) {
                return raw;
            }
        }
    } catch {
        // Ignore storage access errors in restricted/headless contexts
    }
    return 1.0;
}

/**
 * Creates a clean combo tracking state object with all geometric and hit-tracking fields initialized.
 * @returns {object} Initialized combo state.
 */
export function createEmptyCombo() {
    return {
        actorId: null,
        skillId: null,
        targetId: null,
        count: 0,
        totalDamage: 0,
        targetDamages: {},
        targetHitCounts: {},
        knockedBack: false,
        keepAlive: false,
        targetChangedThisHit: false,
        heldForCoverActorId: null,
        moveX: undefined,
        deltaY: undefined,
        prevMoveX: 0,
        prevDeltaY: 0,
        aoeCenterX: undefined,
        aoeCenterY: undefined,
        aoeCasterId: null,
        atCenterStage: false,
        lastFrameIndex: -1
    };
}

/**
 * Resets the active combo tracking state back to its initial clean structure.
 */
export function resetComboState() {
    engineState.currentCombo = createEmptyCombo();
}

/**
 * Global mutable state store for the battle visualizer engine.
 */
export const engineState = {
    lastReportData: null,
    frames: [],
    currentFrameIndex: 0,
    isPlaying: false,
    playbackSpeed: loadSavedPlaybackSpeed(),
    timeScale: 1.0,
    playbackToken: 0,
    currentCombo: createEmptyCombo(),
    floatTracker: new Map(),
    shadowRoot: null,
    hostElement: null,
    actors: new Map(),
    totalTurns: 0,
    battleResult: 'WIN',
    onImportReport: null,
    activeKeydownHandler: null
};

/**
 * Updates the active playback speed multiplier and persists it to `localStorage`.
 * @param {number} speed - Desired speed multiplier from `PLAYBACK_SPEEDS`.
 * @returns {number} The updated playback speed.
 */
export function setPlaybackSpeed(speed) {
    const validSpeed = PLAYBACK_SPEEDS.includes(speed) ? speed : 1.0;
    engineState.playbackSpeed = validSpeed;
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(SPEED_STORAGE_KEY, String(validSpeed));
        }
    } catch {
        // Ignore storage write errors
    }
    return validSpeed;
}

/**
 * Calculates the effective playback speed combining user speed multiplier and cinematic slow-motion scale.
 * @returns {number} Clamped effective playback speed multiplier.
 */
export function getEffectiveSpeed() {
    return Math.max(0.05, engineState.playbackSpeed * engineState.timeScale);
}

/**
 * Increments and returns a new playback token to invalidate outdated asynchronous loops and timers.
 * @returns {number} The newly issued playback token.
 */
export function nextPlaybackToken() {
    engineState.playbackToken += 1;
    return engineState.playbackToken;
}