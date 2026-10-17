// ==========================================
// FILE: src/timeline.js
// ==========================================
/**
 * @fileoverview Pure timeline calculations, milestone marker extraction,
 * seek label formatting, and ATB action bar progress tracking.
 */

import { DEFAULT_AVATAR_URL } from './constants.js';
import {
    ULTIMATE_CUTIN_EXCLUDED_SKILLS,
    ULTIMATE_SUBFRAME_REGEX,
    isPrimaryUltimateTriggerFrame
} from './profiles.js';
import {
    engineState,
    getEffectiveSpeed
} from './state.js';
import { escapeHtml } from './utils.js';

// Re-export stage DOM sync utilities and ultimate frame trigger for unified backward-compatibility
export * from './stageSync.js';
export { isPrimaryUltimateTriggerFrame };

/**
 * Scans the combat frame timeline and extracts key milestone events (Boss Rebirth, K.O. Death,
 * Ultimate Activation, Contract Invocation, and Summon Spawn) for rendering interactive pins
 * along the seek progress bar.
 *
 * @param {Array<object>} frames - Full array of parsed combat frames.
 * @returns {Array<{ frameIndex: number, turnNumber: number, category: string, icon: string, title: string, detail: string }>}
 */
export function extractTimelineMarkers(frames) {
    if (!Array.isArray(frames) || frames.length === 0) return [];

    const markers = [];
    const lastUltTurnByActor = new Map();

    frames.forEach((f, idx) => {
        const events = [];

        // 1. Boss Phase 2+ Rebirth / Revival
        if (f.rebirthHeal) {
            const targetId = f.targetId || f.actorId;
            const actorName = engineState.actors.get(targetId)?.name || 'Boss';
            events.push({
                priority: 5,
                category: 'rebirth',
                icon: '🔥',
                title: `🔥 二階段甦醒：${actorName}`
            });
        }

        // 2. Unit Defeat / K.O.
        if (f.isDeathEvent && f.deadActorId) {
            const deadName = engineState.actors.get(f.deadActorId)?.name || f.deadActorId;
            events.push({
                priority: 4,
                category: 'death',
                icon: '💀',
                title: `💀 陣亡：${deadName}`
            });
        }

        // 3. Primary Ultimate Cut-In Trigger
        if (isPrimaryUltimateTriggerFrame(f)) {
            const msg = String(f.message || '').trim();
            const isSubFrame = ULTIMATE_SUBFRAME_REGEX.test(msg) || f.rosarioEvent === 'INSCRIBE_CROSS';
            if (!isSubFrame && lastUltTurnByActor.get(f.actorId) !== f.turnNumber) {
                lastUltTurnByActor.set(f.actorId, f.turnNumber);
                const actorName = engineState.actors.get(f.actorId)?.name || f.actorId;
                events.push({
                    priority: 3,
                    category: 'ultimate',
                    icon: '🌟',
                    title: `🌟 奧義發動：${actorName}`
                });
            } else if (isSubFrame) {
                lastUltTurnByActor.set(f.actorId, f.turnNumber);
            }
        }

        // 4. Contract / Marriage Acceptance
        if (f.contractEvent === 'ACCEPT') {
            const actorName = engineState.actors.get(f.actorId)?.name || f.actorId;
            const partnerName = f.targetId ? engineState.actors.get(f.targetId)?.name : null;
            events.push({
                priority: 2,
                category: 'contract',
                icon: '💍',
                title: `💍 契約締結：${actorName}${partnerName ? ` & ${partnerName}` : ''}`
            });
        }

        // 5. Dynamic Summon Spawn
        if (f.isSummonEvent && f.summonedActorId) {
            const summonName = engineState.actors.get(f.summonedActorId)?.name || f.summonedActorId;
            events.push({
                priority: 1,
                category: 'summon',
                icon: '🌀',
                title: `🌀 召喚登場：${summonName}`
            });
        }

        if (events.length > 0) {
            events.sort((a, b) => b.priority - a.priority);
            const top = events[0];
            const combinedTitle = events.map(e => e.title).join(' ｜ ');
            const rawMsg = String(f.message || '').replace(/\s+/g, ' ').trim();
            const detail = rawMsg.length > 46 ? `${rawMsg.slice(0, 46)}…` : rawMsg;

            markers.push({
                frameIndex: idx,
                turnNumber: f.turnNumber,
                category: top.category,
                icon: top.icon,
                title: combinedTitle,
                detail
            });
        }
    });

    return markers;
}

/**
 * Formats a numeric frame index into a compact user-facing turn & frame indicator string.
 *
 * @param {number} frameIndex - Current frame index.
 * @returns {string} Formatted label string, e.g. "T1 (#1/534)".
 */
export function formatSeekLabelText(frameIndex) {
    const total = engineState.frames.length;
    if (total === 0) return 'T1 (#0/0)';
    const clamped = Math.max(0, Math.min(frameIndex, total - 1));
    const turn = engineState.frames[clamped]?.turnNumber ?? 1;
    return `T${turn} (#${clamped + 1}/${total})`;
}

/**
 * Updates actor icon positions along the top ATB/CTB action timeline bar based on each actor's
 * pre-calculated `turnNumbers` schedule relative to `currentTurn`.
 *
 * @param {number} currentTurn - Active turn number.
 * @param {boolean} [skipTransition=false] - Whether to snap immediately without CSS transition.
 * @param {Map<string, boolean>|null} [summonStateMap=null] - Map of currently spawned actors.
 */
export function updateATBUI(currentTurn, skipTransition = false, summonStateMap = null) {
    const sr = engineState.shadowRoot;
    if (!sr) return;
    const track = sr.getElementById('ctb-track');
    if (!track) return;

    engineState.actors.forEach(actor => {
        if (actor.currentHp <= 0 && actor.turnNumbers.length === 0) return;

        const isSpawned = summonStateMap
            ? summonStateMap.get(actor.id) !== false
            : actor.initiallySpawned !== false;

        let progress = 0;
        const turns = actor.turnNumbers;

        if (turns.length === 0) {
            progress = 0;
        } else if (currentTurn <= turns[0]) {
            progress = turns[0] > 0 ? (currentTurn / turns[0]) * 100 : 100;
        } else {
            let prev = turns[0];
            let next = null;
            for (let i = 0; i < turns.length; i++) {
                if (turns[i] === currentTurn) {
                    progress = 100;
                    prev = turns[i];
                    next = turns[i];
                    break;
                } else if (turns[i] > currentTurn) {
                    next = turns[i];
                    break;
                } else {
                    prev = turns[i];
                }
            }

            if (progress !== 100) {
                if (next !== null) {
                    progress = ((currentTurn - prev) / (next - prev)) * 100;
                } else {
                    const avgGap = turns.length > 1 ? (turns[turns.length - 1] - turns[0]) / (turns.length - 1) : 4;
                    progress = ((currentTurn - prev) / avgGap) * 100;
                    progress = Math.min(95, progress);
                }
            }
        }

        progress = Math.max(0, Math.min(100, progress));

        let icon = sr.getElementById(`ctb-icon-${actor.id}`);
        if (!icon) {
            icon = document.createElement('div');
            icon.id = `ctb-icon-${actor.id}`;
            icon.className = `ctb-icon ${actor.side}`;
            icon.innerHTML = `<img src="${escapeHtml(actor.avatar)}" onerror="this.src='${DEFAULT_AVATAR_URL}'">`;
            track.appendChild(icon);
        }

        icon.style.zIndex = Math.round(progress);

        const prevProgress = Number(icon.dataset.progress || 0);
        if (skipTransition || progress < prevProgress - 20) {
            icon.style.transition = 'none';
            icon.style.left = `${progress}%`;
            void icon.offsetHeight;
        } else {
            icon.style.transition = `left ${400 / getEffectiveSpeed()}ms linear`;
            icon.style.left = `${progress}%`;
        }

        if (progress === 100) icon.classList.add('acting');
        else icon.classList.remove('acting');

        if (!isSpawned || (actor.currentHp <= 0 && progress !== 100)) {
            icon.style.opacity = '0';
        } else {
            icon.style.opacity = '1';
        }

        icon.dataset.progress = progress;
    });
}
