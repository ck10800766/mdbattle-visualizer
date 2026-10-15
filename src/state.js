// ==========================================
// FILE: src/state.js
// ==========================================

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
        moveX: undefined,
        deltaY: undefined,
        prevMoveX: 0,
        prevDeltaY: 0,
        aoeCenterX: undefined,
        aoeCenterY: undefined,
        atCenterStage: false,
        lastFrameIndex: -1
    };
}

/**
 * Global mutable state store for the battle visualizer engine.
 */
export const engineState = {
    lastReportData: null,
    frames: [],
    currentFrameIndex: 0,
    isPlaying: false,
    playbackSpeed: 1.0,
    timeScale: 1.0,
    playbackToken: 0,
    currentCombo: createEmptyCombo(),
    floatTracker: new Map(),
    shadowRoot: null,
    hostElement: null,
    actors: new Map(),
    totalTurns: 0,
    battleResult: 'WIN'
};

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