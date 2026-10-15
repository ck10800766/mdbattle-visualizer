// ==========================================
// FILE: src/calibrator.js
// ==========================================
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
 * Reconstructs unlogged Phase 2 Boss HP regeneration (e.g., kneeling at 1 HP and reviving)
 * by walking backward from the anchor state through recorded HP deltas.
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
            // No low-HP phase occurred; ensure anchor and trailing frames match anchorHp
            for (let i = anchorIndex; i < frames.length; i++) {
                frames[i].actorsHpState.set(actor.id, anchorHp);
            }
            return;
        }

        const hpAtLowStart = frames[lowHpStartIndex].actorsHpState.get(actor.id) ?? 0;

        // Sum all unclamped HP deltas between lowHpStartIndex and anchorIndex
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

        // If no hidden phase-transition heal exists, sync anchor frames and exit
        if (Math.abs(missingHeal) <= 1) {
            for (let i = anchorIndex; i < frames.length; i++) {
                frames[i].actorsHpState.set(actor.id, anchorHp);
            }
            return;
        }

        const searchLimit = firstPostRebirthDeltaIndex !== -1 ? firstPostRebirthDeltaIndex : anchorIndex;

        // Primary match: narrative frame where the Boss stands back up / enters Phase 2
        let rebirthFrameIndex = -1;
        for (let i = lowHpStartIndex + 1; i <= searchLimit; i++) {
            const f = frames[i];
            if (
                f.actorId === actor.id &&
                ['TEXT', 'BOSS_DIALOGUE', 'SKILL_TEXT'].includes(f.type) &&
                REBIRTH_RULES.dialogueRegex.test(f.message)
            ) {
                rebirthFrameIndex = i;
                break;
            }
        }

        // Fallback 1: first BLOCK frame containing the rebirth keyword
        if (rebirthFrameIndex === -1) {
            for (let i = lowHpStartIndex + 1; i <= searchLimit; i++) {
                const f = frames[i];
                if (
                    f.targetId === actor.id &&
                    f.type === 'BLOCK' &&
                    f.message.includes(REBIRTH_RULES.blockKeyword)
                ) {
                    rebirthFrameIndex = i;
                    break;
                }
            }
        }

        // Fallback 2: frame immediately at the first post-rebirth HP delta
        if (rebirthFrameIndex === -1) {
            rebirthFrameIndex = searchLimit;
        }

        // Walk backward from anchorIndex down to rebirthFrameIndex using recorded hpDeltas
        const backwardHp = new Array(anchorIndex + 1);
        let currentBackHp = anchorHp;
        for (let i = anchorIndex; i >= rebirthFrameIndex; i--) {
            backwardHp[i] = currentBackHp;
            const delta = frames[i].hpDeltas?.get(actor.id) || 0;
            currentBackHp = Math.max(0, Math.min(actor.maxHp, currentBackHp - delta));
        }

        const prevHp = frames[Math.max(0, rebirthFrameIndex - 1)].actorsHpState.get(actor.id) ?? hpAtLowStart;
        const healedAmount = Math.round(backwardHp[rebirthFrameIndex] - prevHp);

        if (healedAmount > 0) {
            const rebirthFrame = frames[rebirthFrameIndex];
            rebirthFrame.rebirthHeal = true;
            rebirthFrame.isBeneficial = true;
            rebirthFrame.value = healedAmount;
            if (!rebirthFrame.vfx.includes('flash-green')) {
                rebirthFrame.vfx.push('flash-green');
            }
        }

        for (let i = rebirthFrameIndex; i <= anchorIndex; i++) {
            frames[i].actorsHpState.set(actor.id, backwardHp[i]);
        }
        for (let i = anchorIndex + 1; i < frames.length; i++) {
            frames[i].actorsHpState.set(actor.id, anchorHp);
        }
    });
}