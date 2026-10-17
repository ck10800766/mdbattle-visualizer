// ==========================================
// FILE: src/calibrator.js
// ==========================================
/**
 * @fileoverview Post-processing calibration passes executed after initial frame construction.
 * 1. `markAOEWaves`: Detects multi-target or known AOE attack sequences so the stage choreographer
 *    animates center-stage casting instead of sequential single-target lunges.
 * 2. `calibrateHpWithAnchors`: Uses terminal `HP_REMAINING` or `DEATH` logs as ground-truth anchors
 *    to backward-calculate hidden Boss Phase 2+ revival heals.
 */

import { engineState } from './state.js';
import {
    KNOWN_AOE_SKILLS,
    AOE_EXCLUDED_SKILLS,
    REBIRTH_RULES,
    normalizeAOESkillGroup
} from './profiles.js';

/**
 * Scans the frame timeline to detect and tag multi-target or known AOE attack waves
 * so the stage choreographer can animate center-stage casting instead of individual lunges.
 * @param {Array<object>} frames - The list of combat state frames.
 */
export function markAOEWaves(frames) {
    let i = 0;
    while (i < frames.length) {
        const f = frames[i];
        if (
            !['DAMAGE', 'MISS', 'BLOCK', 'COUNTER'].includes(f.type) ||
            f.isSelfDamage ||
            f.isEnvironmentalPulse
        ) {
            i++;
            continue;
        }

        const isCounterFrame = f.type === 'COUNTER' || f.isCounter;
        const casterId = isCounterFrame ? f.targetId : f.actorId;
        const rawSkillId = isCounterFrame ? f.incomingSkillId : f.skillId;

        if (!casterId || !rawSkillId || AOE_EXCLUDED_SKILLS.has(rawSkillId)) {
            i++;
            continue;
        }

        const baseSkill = normalizeAOESkillGroup(rawSkillId);
        const waveAnimatedFrames = [];
        const distinctTargets = new Set();
        let j = i;
        let lastWaveFrameIndex = i;

        while (j < frames.length) {
            const cur = frames[j];

            if (cur.isSelfDamage || cur.isEnvironmentalPulse) break;

            if (['DAMAGE', 'MISS', 'BLOCK'].includes(cur.type) && !cur.isCounter) {
                if (cur.actorId === casterId && normalizeAOESkillGroup(cur.skillId) === baseSkill) {
                    waveAnimatedFrames.push(cur);
                    if (cur.targetId) distinctTargets.add(cur.targetId);
                    lastWaveFrameIndex = j;
                    j++;
                    continue;
                }
                break;
            }

            if (cur.type === 'COUNTER' || cur.isCounter) {
                if (cur.targetId === casterId && normalizeAOESkillGroup(cur.incomingSkillId) === baseSkill) {
                    if (!cur.isCounterSetup) {
                        waveAnimatedFrames.push(cur);
                    }
                    if (cur.actorId) distinctTargets.add(cur.actorId);
                    lastWaveFrameIndex = j;
                    j++;
                    continue;
                }
                break;
            }

            if (['HEAL', 'LUCK_EVENT', 'SUMMON'].includes(cur.type)) {
                break;
            }
            if (cur.type === 'SKILL_TEXT' && cur.actorId !== casterId) {
                break;
            }
            if (
                cur.type === 'SKILL_TEXT' &&
                cur.actorId === casterId &&
                cur.skillId &&
                normalizeAOESkillGroup(cur.skillId) !== baseSkill
            ) {
                break;
            }

            j++;
        }

        const isKnownAOE = KNOWN_AOE_SKILLS.has(rawSkillId) || KNOWN_AOE_SKILLS.has(baseSkill);
        const isMultiTargetWave =
            distinctTargets.size >= 2 &&
            waveAnimatedFrames.length <= distinctTargets.size * 2;

        if ((isKnownAOE || isMultiTargetWave) && waveAnimatedFrames.length > 0) {
            waveAnimatedFrames.forEach((wf, idx) => {
                wf.isAOE = true;
                wf.aoeCasterId = casterId;
                wf.isAOEFirst = idx === 0;
                wf.isAOELast = idx === waveAnimatedFrames.length - 1;
            });
            i = lastWaveFrameIndex + 1;
        } else {
            i++;
        }
    }
}

/**
 * Calibrates actor HP timelines using terminal HP_REMAINING or DEATH anchors.
 * Supports both single and multi-stage Boss revivals (e.g., Oni Gunsou reviving multiple times)
 * by segmenting phases at revival narrative frames or walking backward from the anchor state.
 * @param {Array<object>} frames - The list of combat state frames.
 */
export function calibrateHpWithAnchors(frames) {
    engineState.actors.forEach(actor => {
        if (actor.hideHp) return;
        let anchorIndex = -1;
        let anchorHp = null;

        for (let i = frames.length - 1; i >= 0; i--) {
            const f = frames[i];
            if (f.type === 'HP_REMAINING' && f.actorId === actor.id) {
                anchorIndex = i;
                anchorHp = f.value;
                break;
            }
            if (['DEATH', 'PLAYER_DEATH', 'PLAYER_DEFEAT'].includes(f.type) && f.actorId === actor.id) {
                anchorIndex = i;
                anchorHp = 0;
                break;
            }
        }

        if (anchorIndex < 0 || anchorHp == null) return;

        // Locate the first frame where forward-calculated HP dropped to <= 1
        let lowHpStartIndex = -1;
        for (let i = 0; i <= anchorIndex; i++) {
            const hp = frames[i].actorsHpState.get(actor.id);
            if (hp != null && hp <= 1) {
                lowHpStartIndex = i;
                break;
            }
        }

        if (lowHpStartIndex < 0) {
            for (let i = anchorIndex; i < frames.length; i++) {
                frames[i].actorsHpState.set(actor.id, anchorHp);
            }
            return;
        }

        const hpAtLowStart = frames[lowHpStartIndex].actorsHpState.get(actor.id) ?? 0;

        let sumDeltasAfterLow = 0;
        let firstPostRebirthDeltaIndex = -1;
        for (let i = lowHpStartIndex + 1; i <= anchorIndex; i++) {
            const delta = frames[i].hpDeltas?.get(actor.id) || 0;
            sumDeltasAfterLow += delta;
            if (delta !== 0 && firstPostRebirthDeltaIndex === -1) {
                firstPostRebirthDeltaIndex = i;
            }
        }

        const expectedEndHpWithoutRebirth = hpAtLowStart + sumDeltasAfterLow;
        const missingHeal = anchorHp - expectedEndHpWithoutRebirth;

        if (Math.abs(missingHeal) <= 1) {
            for (let i = anchorIndex; i < frames.length; i++) {
                frames[i].actorsHpState.set(actor.id, anchorHp);
            }
            return;
        }

        // Collect all explicit narrative revival frames for this actor (supports multi-revive bosses)
        const rebirthIndices = [];
        let lastDamageFrameSeen = lowHpStartIndex;
        for (let i = lowHpStartIndex + 1; i <= anchorIndex; i++) {
            const f = frames[i];
            const delta = f.hpDeltas?.get(actor.id) || 0;
            if (delta < 0) {
                lastDamageFrameSeen = i;
            }
            if (
                f.actorId === actor.id &&
                ['TEXT', 'BOSS_DIALOGUE', 'SKILL_TEXT'].includes(f.type) &&
                REBIRTH_RULES.dialogueRegex.test(f.message)
            ) {
                // Only register one revival per damage phase
                if (rebirthIndices.length === 0 || lastDamageFrameSeen > rebirthIndices[rebirthIndices.length - 1]) {
                    rebirthIndices.push(i);
                } else {
                    // Use the latest line in the same revival sequence (e.g., "站了起來，傷口全部合上了。")
                    rebirthIndices[rebirthIndices.length - 1] = i;
                }
            }
        }

        // Fallback if no dialogue matched
        if (rebirthIndices.length === 0) {
            const searchLimit = firstPostRebirthDeltaIndex !== -1 ? firstPostRebirthDeltaIndex : anchorIndex;
            let fallbackIdx = -1;
            for (let i = lowHpStartIndex + 1; i <= searchLimit; i++) {
                const f = frames[i];
                if (
                    f.targetId === actor.id &&
                    f.type === 'BLOCK' &&
                    f.message.includes(REBIRTH_RULES.blockKeyword)
                ) {
                    fallbackIdx = i;
                    break;
                }
            }
            rebirthIndices.push(fallbackIdx !== -1 ? fallbackIdx : searchLimit);
        }

        // Calibrate each revival segment [rebirthStart .. segmentEnd] by walking backward from segmentEndHp
        for (let s = 0; s < rebirthIndices.length; s++) {
            const rIdx = rebirthIndices[s];
            const segEnd = s + 1 < rebirthIndices.length ? rebirthIndices[s + 1] - 1 : anchorIndex;
            const segEndHp = s + 1 < rebirthIndices.length ? 0 : anchorHp;

            const backwardHp = new Array(segEnd - rIdx + 1);
            let currentBackHp = segEndHp;
            for (let i = segEnd; i >= rIdx; i--) {
                backwardHp[i - rIdx] = currentBackHp;
                const delta = frames[i].hpDeltas?.get(actor.id) || 0;
                currentBackHp = Math.max(0, Math.min(actor.maxHp, currentBackHp - delta));
            }

            const prevHp = frames[Math.max(0, rIdx - 1)].actorsHpState.get(actor.id) ?? 0;
            const healedAmount = Math.round(backwardHp[0] - prevHp);

            if (healedAmount > 0) {
                const rebirthFrame = frames[rIdx];
                rebirthFrame.rebirthHeal = true;
                if (['TEXT', 'BOSS_DIALOGUE', 'SKILL_TEXT'].includes(rebirthFrame.type) || !rebirthFrame.value) {
                    rebirthFrame.isBeneficial = true;
                    rebirthFrame.value = healedAmount;
                }
                if (!rebirthFrame.vfx.includes('flash-green')) {
                    rebirthFrame.vfx.push('flash-green');
                }
            }

            for (let i = rIdx; i <= segEnd; i++) {
                const hp = backwardHp[i - rIdx];
                frames[i].actorsHpState.set(actor.id, hp);
                if (hp > 0 || i === rIdx) {
                    frames[i].actorsDeathState.set(actor.id, false);
                }
            }
        }

        for (let i = anchorIndex + 1; i < frames.length; i++) {
            frames[i].actorsHpState.set(actor.id, anchorHp);
        }
    });
}