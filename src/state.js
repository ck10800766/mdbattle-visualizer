// src/state.js

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
        prevDeltaY: 0
    };
}

export const engineState = {
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
 * Returns the effective playback speed combining user speed setting and slow-mo scale.
 */
export function getEffectiveSpeed() {
    return Math.max(0.05, engineState.playbackSpeed * engineState.timeScale);
}

/**
 * Increments and returns a new playback token to cancel outdated async loops/timers.
 */
export function nextPlaybackToken() {
    engineState.playbackToken += 1;
    return engineState.playbackToken;
}

/**
 * Escapes special characters in a string for safe use inside a RegExp constructor.
 */
export function escapeRegExp(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Escapes HTML special characters to prevent markup corruption before highlighting names.
 */
export function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Highlights all actor names in a single regex pass without corrupting HTML tags.
 */
export function formatLogMessage(rawMessage, actorsMap) {
    const safeMsg = escapeHtml(rawMessage);
    const sortedActors = Array.from(actorsMap.values())
        .filter(a => a && a.name)
        .sort((a, b) => b.name.length - a.name.length);

    if (sortedActors.length === 0) return safeMsg;

    const sideByEscapedName = new Map();
    const patterns = [];

    sortedActors.forEach(actor => {
        const escapedHtmlName = escapeHtml(actor.name);
        if (!sideByEscapedName.has(escapedHtmlName)) {
            sideByEscapedName.set(escapedHtmlName, actor.side);
            patterns.push(escapeRegExp(escapedHtmlName));
        }
    });

    if (patterns.length === 0) return safeMsg;

    const regex = new RegExp(`(${patterns.join('|')})`, 'g');
    return safeMsg.replace(regex, (match) => {
        const side = sideByEscapedName.get(match);
        const nameClass = side === 'left' ? 'actor-name-left' : 'actor-name-right';
        return `<span class="${nameClass}">${match}</span>`;
    });
}