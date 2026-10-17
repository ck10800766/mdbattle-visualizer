// ==========================================
// FILE: src/combo.js
// ==========================================
/**
 * @fileoverview Combo state tracking, same-turn frame lookahead analysis, and
 * global side combo banner rendering.
 */

import { engineState, createEmptyCombo } from './state.js';
import { isSceneNarrationFrame } from './cinematics.js';
import { ULTIMATE_SUBFRAME_REGEX } from './profiles.js';

/**
 * Determines whether two skill IDs belong to the same multi-hit attack combo chain
 * (e.g., diluc_onslaught_1 -> diluc_onslaught_2 -> diluc_onslaught_3,
 *  diluc_sword_1 -> diluc_sword_2, diluc_dawn_slash -> diluc_dawn_phoenix).
 * @param {string|null|undefined} skillA - First skill ID.
 * @param {string|null|undefined} skillB - Second skill ID.
 * @returns {boolean} True if both skills belong to the same combo sequence.
 */
export function isSameSkillCombo(skillA, skillB) {
    if (!skillA || !skillB) return false;
    if (skillA === skillB) return true;

    // Strip trailing numeric stage suffixes (_1, _2, _3, etc.)
    const rootA = skillA.replace(/_\d+$/, '');
    const rootB = skillB.replace(/_\d+$/, '');
    if (rootA === rootB) return true;

    // Strip sub-hit suffixes (_slash, _phoenix, _burst, _finish, _hit, _strike, _flurry)
    const familyA = rootA.replace(/_(slash|phoenix|burst|finish|hit|strike|flurry)$/, '');
    const familyB = rootB.replace(/_(slash|phoenix|burst|finish|hit|strike|flurry)$/, '');
    if (familyA && familyA === familyB) return true;

    return false;
}

/**
 * Inspects upcoming frames within the same turn to evaluate combo continuation
 * and physical actor positioning (refer to docs/DECISIONS.md ADR-001).
 *
 * Architecture Rule (ADR-001):
 * - Uninterrupted combo on the same target = attacker stays in position (`stayAtTarget = true`).
 * - Attacker ONLY returns to origin if:
 *   1. Switching to an AOE skill (`lookahead.isAOE`).
 *   2. Switching to a different target (`lookahead.targetId !== frame.targetId`).
 *   3. Interrupted by non-combat cinematic pauses (heals, summons, scene narration banners,
 *      dice checks, falling luck objects, dialogues, or counter pushback).
 *
 * @param {number} currentIndex - Index of the active frame in `engineState.frames`.
 * @param {object} frame - Active combat frame object.
 * @returns {{ isNextFrameSameCombo: boolean, isNextTargetDifferent: boolean, shouldReturnToOrigin: boolean }}
 */
export function lookaheadComboState(currentIndex, frame) {
    if (!frame.actorId || !['DAMAGE', 'MISS', 'BLOCK', 'COUNTER'].includes(frame.type)) {
        return { isNextFrameSameCombo: false, isNextTargetDifferent: false, shouldReturnToOrigin: false };
    }

    let isNextFrameSameCombo = false;
    let isNextTargetDifferent = false;
    let shouldReturnToOrigin = false;

    for (let i = currentIndex + 1; i < engineState.frames.length; i++) {
        const lookahead = engineState.frames[i];

        // 1. Turn boundary: combos cannot cross turn boundaries
        if (lookahead.turnNumber !== frame.turnNumber) break;

        // 2. Interruption: Luck Event (falling object) forces attacker home to avoid overlapping target
        if (lookahead.type === 'LUCK_EVENT') {
            shouldReturnToOrigin = true;
            continue;
        }

        // 3. Interruption: Non-combat cinematic events (heals, dialogues, summons, scene narration, dice checks)
        if (
            ['HEAL', 'SP_RECOVER', 'BOSS_DIALOGUE', 'SUMMON'].includes(lookahead.type) ||
            isSceneNarrationFrame(lookahead) ||
            lookahead.diceCheck
        ) {
            shouldReturnToOrigin = true;
            continue;
        }

        // 4. Interruption: Dialogue text or third-party narrative TEXT frames
        if (lookahead.type === 'TEXT') {
            const isMidComboConnector =
                lookahead.actorId === frame.actorId &&
                ULTIMATE_SUBFRAME_REGEX.test(lookahead.message || '');
            if (!isMidComboConnector) {
                shouldReturnToOrigin = true;
            }
            continue;
        }

        // 5. Interruption: Skill text that breaks flow (cover guard, etc.)
        if (lookahead.type === 'SKILL_TEXT') {
            if (lookahead.isCoverEvent || isSceneNarrationFrame(lookahead)) {
                shouldReturnToOrigin = true;
            }
            continue;
        }

        // 6. Interruption: Non-passive self buffs
        if (lookahead.type === 'BUFF_APPLY' && !lookahead.passiveId && lookahead.targetId === lookahead.actorId) {
            shouldReturnToOrigin = true;
            continue;
        }

        // 7. Combat resolution frames
        if (['DAMAGE', 'MISS', 'BLOCK', 'COUNTER'].includes(lookahead.type)) {
            if (lookahead.isCounter || lookahead.type === 'COUNTER') {
                const counteredAttackerId = lookahead.counterSource?.targetId || lookahead.targetId;
                if (counteredAttackerId && counteredAttackerId !== frame.actorId) {
                    shouldReturnToOrigin = true;
                    break;
                }
                continue;
            }
            if (lookahead.isSelfDamage || lookahead.isEnvironmentalPulse) {
                shouldReturnToOrigin = true;
                continue;
            }

            // Same attacker continuing in the same turn
            if (lookahead.actorId === frame.actorId) {
                isNextFrameSameCombo = true;
                if (!frame.isAOE && lookahead.isAOE) {
                    shouldReturnToOrigin = true;
                }
                if (lookahead.targetId !== frame.targetId) {
                    isNextTargetDifferent = true;
                }
            }
            break;
        }
    }

    return { isNextFrameSameCombo, isNextTargetDifferent, shouldReturnToOrigin };
}

/**
 * Advances `engineState.currentCombo` state deterministically for a given frame.
 * Shared between runtime DOM choreography (`playCombatAnimation`) and headless snapshot testing.
 *
 * @param {object} frame - Active combat frame.
 * @param {boolean} isNextFrameSameCombo - Whether the attacker continues their combo on the next hit frame.
 */
export function advanceComboState(frame, isNextFrameSameCombo) {
    if (frame.isCoverEvent) {
        engineState.currentCombo.heldForCoverActorId = null;
        engineState.currentCombo.knockedBack = true;
        engineState.currentCombo.keepAlive = false;
        return;
    }

    if (
        !frame.actorId ||
        !['DAMAGE', 'MISS', 'COUNTER', 'BLOCK'].includes(frame.type) ||
        frame.isCounterSetup ||
        frame.isSelfDamage ||
        frame.isEnvironmentalPulse
    ) {
        return;
    }

    // If a counter frame involves a different attacker than the active combo owner, break the previous combo
    if (frame.isCounter || frame.type === 'COUNTER') {
        const counteredAttackerId = frame.counterSource?.targetId || frame.targetId;
        if (counteredAttackerId && engineState.currentCombo.actorId !== counteredAttackerId) {
            engineState.currentCombo.keepAlive = false;
            engineState.currentCombo.knockedBack = true;
        }
        return;
    }

    const displayDamage = frame.value || frame.actualDamage || 0;

    if (engineState.currentCombo.lastFrameIndex !== frame.index) {
        if (engineState.currentCombo.actorId === frame.actorId && engineState.currentCombo.keepAlive) {
            engineState.currentCombo.count++;
            engineState.currentCombo.totalDamage = (engineState.currentCombo.totalDamage || 0) + displayDamage;

            if (!engineState.currentCombo.targetDamages) engineState.currentCombo.targetDamages = {};
            engineState.currentCombo.targetDamages[frame.targetId] =
                (engineState.currentCombo.targetDamages[frame.targetId] || 0) + displayDamage;

            if (!engineState.currentCombo.targetHitCounts) engineState.currentCombo.targetHitCounts = {};
            engineState.currentCombo.targetHitCounts[frame.targetId] =
                (engineState.currentCombo.targetHitCounts[frame.targetId] || 0) + 1;

            if (engineState.currentCombo.targetId !== frame.targetId) {
                engineState.currentCombo.targetId = frame.targetId;
                engineState.currentCombo.moveX = undefined;
                engineState.currentCombo.deltaY = undefined;
                engineState.currentCombo.targetChangedThisHit = true;
            } else {
                engineState.currentCombo.targetChangedThisHit = false;
            }
        } else {
            engineState.currentCombo = {
                ...createEmptyCombo(),
                actorId: frame.actorId,
                skillId: frame.skillId,
                targetId: frame.targetId,
                count: 1,
                totalDamage: displayDamage,
                targetDamages: { [frame.targetId]: displayDamage },
                targetHitCounts: { [frame.targetId]: 1 },
                lastFrameIndex: frame.index
            };
        }
        engineState.currentCombo.lastFrameIndex = frame.index;
    }

    engineState.currentCombo.keepAlive = isNextFrameSameCombo;
}

/**
 * Checks whether the original attacker has additional hits queued against the same defender
 * in the current turn after a mid-combo counterattack occurs.
 *
 * @param {number} currentIndex - Current frame index.
 * @param {number} turnNumber - Current turn number.
 * @param {string} actorId - Original attacker ID.
 * @param {string} targetId - Defender ID.
 * @returns {boolean} True if more hits on the same target follow in this turn.
 */
export function hasMoreHitsOnSameTargetInTurn(currentIndex, turnNumber, actorId, targetId) {
    for (let i = currentIndex + 1; i < engineState.frames.length; i++) {
        const lookahead = engineState.frames[i];
        if (lookahead.turnNumber !== turnNumber) break;
        if (lookahead.isCounter || lookahead.type === 'COUNTER') continue;
        if (['DAMAGE', 'MISS', 'BLOCK'].includes(lookahead.type)) {
            return lookahead.actorId === actorId && lookahead.targetId === targetId;
        }
    }
    return false;
}

/**
 * Renders or updates the global side combo counter banner (`N HIT! / M DMG`) in the top corner
 * of the arena when `engineState.currentCombo.count > 1`.
 *
 * @param {HTMLElement} arena - Stage `#arena` element.
 * @param {object} frame - Current combat frame.
 * @param {number} speed - Effective playback speed multiplier.
 */
export function renderComboBanner(arena, frame, speed) {
    if (engineState.currentCombo.count <= 1) return;

    const actor = engineState.actors.get(frame.actorId);
    const side = actor ? actor.side : 'left';
    const existingCombo = arena.querySelector(`.global-combo-text-${side}`);
    if (existingCombo) existingCombo.remove();

    const comboEl = document.createElement('div');
    comboEl.className = `combo-text global-combo-text-${side}`;
    comboEl.innerHTML = `
        <div style="font-style: italic;">${engineState.currentCombo.count} HIT!</div>
        <div style="font-size: 36px; color: #ff6b6b; margin-top: -5px; text-shadow: 0 4px 10px rgba(0,0,0,0.8), 0 0 15px rgba(255, 107, 107, 0.8);">
            ${engineState.currentCombo.totalDamage} DMG
        </div>
    `;
    comboEl.style.cssText = `
        position: absolute; top: 10%; z-index: 60;
        color: #63b3ed; font-size: 64px; font-weight: 900; text-align: center;
        text-shadow: 0 4px 10px rgba(0,0,0,0.8), 0 0 15px rgba(99, 179, 237, 0.9);
        pointer-events: none;
        ${side === 'left' ? 'left: 5vw; right: auto;' : 'right: 5vw; left: auto;'}
    `;

    arena.appendChild(comboEl);
    comboEl.animate([
        { transform: 'scale(1.3) translateX(10px)', opacity: 0 },
        { transform: 'scale(1) translateX(0)', opacity: 1 }
    ], { duration: 150 / speed, easing: 'cubic-bezier(0.175, 0.885, 0.32, 1.275)' });

    setTimeout(() => {
        if (comboEl.isConnected) {
            const fade = comboEl.animate(
                [{ opacity: 1 }, { opacity: 0, transform: 'translateY(-20px)' }],
                { duration: 300 / speed, fill: 'forwards' }
            );
            fade.onfinish = () => comboEl.remove();
        }
    }, 1200 / speed);
}

