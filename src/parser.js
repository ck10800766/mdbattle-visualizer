// ==========================================
// FILE: src/parser.js
// ==========================================
/**
 * @fileoverview Deterministic combat log state machine (`buildStateSnapshots`).
 * Transforms raw battle log entries into frame-by-frame snapshots of actor HP,
 * death states, summon states, contract bonds, turn numbers, and VFX triggers,
 * followed by HP anchor calibration and AOE wave grouping.
 */

import { engineState } from './state.js';
import { DEFAULT_AVATAR_URL } from './constants.js';
import {
    createActorEntity,
    inferSummonName,
    parseParticipants,
    getConsolidatedStats
} from './participants.js';
import { markAOEWaves, calibrateHpWithAnchors } from './calibrator.js';
import {
    ENVIRONMENTAL_SKILLS,
    getContractSkillProfile,
    getCrossFinisherProfile,
    SUMMON_DESPAWN_REGEX,
    REBIRTH_RULES,
    isBeneficialBuffSkill
} from './profiles.js';

export {
    createActorEntity,
    inferSummonName,
    parseParticipants,
    getConsolidatedStats
};

/**
 * Checks whether a `COUNTER` log entry is merely a setup line that is immediately followed
 * by a separate `DAMAGE` or `BLOCK` counter resolution entry within the next 5 logs.
 * When true, HP deduction and physical animation are deferred to the resolution entry.
 *
 * @param {Array<object>} logs - Full combat log array.
 * @param {number} index - Current log index.
 * @param {object} log - Current log object (`log.type === 'COUNTER'`).
 * @param {number} rawValue - Numeric value of the current log.
 * @returns {boolean} True if this `COUNTER` log is a setup entry.
 */
function detectCounterSetup(logs, index, log, rawValue) {
    if (log.type !== 'COUNTER') return false;
    for (let j = index + 1; j < Math.min(logs.length, index + 6); j++) {
        const nextLog = logs[j];
        if (
            nextLog &&
            (nextLog.type === 'DAMAGE' || nextLog.type === 'BLOCK') &&
            nextLog.isCounter &&
            (Number(nextLog.value) === rawValue || nextLog.actorId === log.actorId)
        ) {
            return true;
        }
    }
    return false;
}

/**
 * Evaluates whether the current frame initiates a new actor turn on the ATB timeline.
 *
 * Design Note:
 * - Passive procs (`passiveId`), direct follow-ups (`source: 'DIRECT'`), damage reflections
 *   (`source: 'REFLECTION'`), self-inflicted damage, environmental hazard pulses, and
 *   reactive marriage cover lines do not consume a new turn.
 * - For `COUNTER` frames, `targetId` represents the attacker whose action triggered the counter,
 *   so turn ownership is attributed to `frame.targetId`.
 *
 * @param {object} frame - Current combat frame.
 * @param {boolean} isReactiveCoverText - Whether this frame is a reactive contract cover message.
 * @returns {{ isTurnAction: boolean, turnActorId: string|undefined }}
 */
function evaluateTurnOwnership(frame, isReactiveCoverText) {
    let isTurnAction = false;
    let turnActorId = frame.actorId;

    if (frame.type === 'BOSS_DIALOGUE') {
        isTurnAction = true;
    } else if (
        frame.type === 'SKILL_TEXT' &&
        !frame.isCounter &&
        !frame.passiveId &&
        !isReactiveCoverText
    ) {
        isTurnAction = true;
    } else if (
        ['DAMAGE', 'MISS', 'BLOCK'].includes(frame.type) &&
        !frame.isCounter &&
        !frame.isSelfDamage &&
        !frame.isEnvironmentalPulse &&
        frame.source !== 'DIRECT' &&
        frame.source !== 'REFLECTION'
    ) {
        isTurnAction = true;
    } else if (frame.type === 'COUNTER' && frame.targetId) {
        isTurnAction = true;
        turnActorId = frame.targetId;
    }

    return { isTurnAction, turnActorId };
}

/**
 * Processes explicit `SUMMON` logs, narrative summon appearances (e.g., Brick Kiln `mob_kiln_1`
 * constructed mid-fight without a `SUMMON` log), and voluntary summon departures (e.g., Sleeping Knights).
 *
 * @param {object} log - Raw log entry.
 * @param {number} index - Current log index.
 * @param {Array<object>} logs - Full combat log array.
 * @param {object} frame - Current combat frame being constructed.
 * @param {Map<string, boolean>} actorsDeathState - Mutable per-actor death state map.
 * @param {Map<string, boolean>} actorsSummonState - Mutable per-actor summon presence map.
 * @param {Set<string>} explicitlySummonedIds - Set of actor IDs that have an explicit `SUMMON` log.
 * @param {Set<string>} despawnedActors - Set of summon IDs that have voluntarily left the battlefield.
 */
function processSummonLifecycle(
    log,
    index,
    logs,
    frame,
    actorsDeathState,
    actorsSummonState,
    explicitlySummonedIds,
    despawnedActors
) {
    // 1. Explicit SUMMON log entry (always keep hideHp: true for dynamic summons)
    if (log.type === 'SUMMON' && log.targetId) {
        const owner = engineState.actors.get(log.actorId);
        const summonName = inferSummonName(logs, index, log.targetId, owner?.name || '');

        if (!engineState.actors.has(log.targetId)) {
            engineState.actors.set(log.targetId, createActorEntity({
                id: log.targetId,
                name: summonName,
                side: owner ? owner.side : 'left',
                maxHp: 1,
                hideHp: true,
                avatar: owner ? owner.avatar : DEFAULT_AVATAR_URL,
                isSummon: true,
                ownerId: log.actorId,
                initiallySpawned: false
            }));
            actorsDeathState.set(log.targetId, false);
        } else {
            const summonActor = engineState.actors.get(log.targetId);
            summonActor.currentHp = summonActor.maxHp;
            actorsDeathState.set(log.targetId, false);
        }
        despawnedActors.delete(log.targetId);
        actorsSummonState.set(log.targetId, true);
        frame.isSummonEvent = true;
        frame.summonedActorId = log.targetId;
    }

    // 2. Narrative summon spawn (units in participants with summonerId but no explicit SUMMON log)
    if (
        log.actorId &&
        actorsSummonState.get(log.actorId) === false &&
        !explicitlySummonedIds.has(log.actorId) &&
        !despawnedActors.has(log.actorId) &&
        !SUMMON_DESPAWN_REGEX.test(frame.message) &&
        !['DEATH', 'PLAYER_DEATH', 'PLAYER_DEFEAT', 'HP_REMAINING', 'EXP_GAIN'].includes(log.type)
    ) {
        const summonActor = engineState.actors.get(log.actorId);
        if (summonActor && summonActor.isSummon) {
            summonActor.currentHp = summonActor.maxHp;
            actorsDeathState.set(log.actorId, false);
            actorsSummonState.set(log.actorId, true);
            frame.isSummonEvent = true;
            frame.summonedActorId = log.actorId;
        }
    }

    // 3. Summon voluntary despawn (generalized across all summons, projections, and skills)
    if (
        (log.type === 'SKILL_TEXT' || log.type === 'TEXT' || log.type === 'BOSS_DIALOGUE') &&
        SUMMON_DESPAWN_REGEX.test(frame.message)
    ) {
        let candidateId = null;

        // 3a. Direct actorId check (active summon taking a voluntary departure/fading action)
        if (log.actorId) {
            const actingUnit = engineState.actors.get(log.actorId);
            if (actingUnit && actingUnit.isSummon && actorsSummonState.get(log.actorId) !== false) {
                candidateId = log.actorId;
            }
        }

        // 3b. Direct targetId check (e.g. unsummon/recall target)
        if (!candidateId && log.targetId) {
            const targetUnit = engineState.actors.get(log.targetId);
            if (targetUnit && targetUnit.isSummon && actorsSummonState.get(log.targetId) !== false) {
                candidateId = log.targetId;
            }
        }

        // 3c. Contextual resolution by matching active summon names in the narrative message
        if (!candidateId && frame.message) {
            for (const [id, actor] of engineState.actors.entries()) {
                if (actor.isSummon && actorsSummonState.get(id) !== false && actor.name) {
                    if (frame.message.includes(actor.name)) {
                        candidateId = id;
                        break;
                    }
                }
            }
        }

        if (candidateId) {
            actorsSummonState.set(candidateId, false);
            despawnedActors.add(candidateId);
            frame.isDespawnEvent = true;
            frame.despawnedActorId = candidateId;
        }
    }
}

/**
 * Processes marriage/contract skill lifecycle events (`PROPOSE`, `ACCEPT`, `COVER`, `END`)
 * on `SKILL_TEXT` frames, including backtracking up to 5 frames to hold the enemy attacker
 * in position for a seamless guard interception clash.
 *
 * @param {object} frame - Current combat frame.
 * @param {object} contractProfile - Matched entry from `CONTRACT_SKILL_PROFILES`.
 * @param {string} msg - Raw log message text.
 * @param {object|undefined} target - Actor entity for `log.actorId`.
 * @param {Map<string, { partnerId: string|null, skillId: string }>} actorsBondState - Active bond state map.
 * @param {Map<string, number>} contractCutInCount - Cast counter per contract skill ID.
 * @param {(id: string, delta: number) => void} addHpDelta - Helper to record per-frame HP deltas.
 */
function processContractSkillLifecycle(
    frame,
    contractProfile,
    msg,
    target,
    actorsBondState,
    contractCutInCount,
    addHpDelta
) {
    if (contractProfile.proposeRegex.test(msg)) {
        frame.contractEvent = 'PROPOSE';
    } else if (contractProfile.acceptRegex.test(msg)) {
        frame.contractEvent = 'ACCEPT';
        const prevCount = contractCutInCount.get(frame.skillId) || 0;
        frame.isContractRepeat = prevCount > 0;
        contractCutInCount.set(frame.skillId, prevCount + 1);

        if (frame.actorId) {
            actorsBondState.set(frame.actorId, {
                partnerId: frame.targetId || null,
                skillId: frame.skillId
            });
        }
        if (frame.targetId) {
            actorsBondState.set(frame.targetId, {
                partnerId: frame.actorId || null,
                skillId: frame.skillId
            });
        }
    } else if (contractProfile.coverRegex.test(msg)) {
        const coverMatch = msg.match(contractProfile.coverRegex);
        const coverAmount = coverMatch ? Number(coverMatch[1]) : 0;
        frame.contractEvent = 'COVER';
        frame.isCoverEvent = true;
        frame.coverDamage = coverAmount;

        // Locate the enemy actor who triggered this cover event within the preceding 5 frames
        let coverAttackerId = null;
        for (let k = engineState.frames.length - 1; k >= Math.max(0, engineState.frames.length - 5); k--) {
            const prev = engineState.frames[k];
            if (
                prev &&
                ['DAMAGE', 'BLOCK', 'MISS', 'COUNTER'].includes(prev.type) &&
                prev.actorId &&
                prev.actorId !== frame.actorId &&
                prev.actorId !== frame.targetId
            ) {
                coverAttackerId = prev.actorId;
                if (prev.targetId === frame.targetId) {
                    prev.holdPositionForCover = true;
                }
                break;
            }
        }

        if (!coverAttackerId) {
            const protectorSide = target?.side || 'left';
            engineState.actors.forEach(a => {
                if (!coverAttackerId && a.side !== protectorSide && a.currentHp > 0) {
                    coverAttackerId = a.id;
                }
            });
        }
        frame.coverAttackerId = coverAttackerId;

        if (target && coverAmount > 0) {
            if (!target.hideHp) {
                target.currentHp = Math.max(0, target.currentHp - coverAmount);
                addHpDelta(target.id, -coverAmount);
            }
            target.totalDamageTaken += coverAmount;
        }
    } else if (contractProfile.endRegex.test(msg)) {
        frame.contractEvent = 'END';
        actorsBondState.forEach((bond, bondedActorId) => {
            if (bondedActorId === frame.actorId || bond.partnerId === frame.actorId) {
                actorsBondState.delete(bondedActorId);
            }
        });
    }
}

/**
 * Computes deterministic active intervals for combat statuses (DOT, HOT, FATIGUE, SILENCED)
 * and shield barriers based on verified occurrence sequences in raw combat logs.
 *
 * @param {Array<object>} logs - Raw combat log entries.
 * @returns {{
 *   statusIntervals: Array<{ actorId: string, start: number, end: number, status: { id: string, name: string, category: string, icon: string } }>,
 *   shieldIntervals: Array<{ actorId: string, start: number, end: number }>
 * }}
 */
function computeActiveStatusAndShieldIntervals(logs) {
    const statusIntervals = [];
    const shieldIntervals = [];

    // 1. Collect and cluster DOT / HOT occurrences
    const effectLogs = [];
    logs.forEach((l, idx) => {
        if (!l) return;
        if (l.type === 'BUFF_EFFECT') {
            const msg = String(l.message || '');
            const isHot = l.buffType === 'HOT' || (/恢復|回復/.test(msg) && !/傷害|失去/.test(msg));
            const buffId = l.buffId || l.skillId || (isHot ? 'hot' : 'dot');
            let name = buffId;
            const match = msg.match(/受到\s*(.+?)\s*影響/);
            if (match) name = match[1];
            effectLogs.push({
                idx,
                actorId: l.actorId,
                buffId,
                name: isHot ? (name || '持續恢復') : (name || '持續傷害'),
                category: isHot ? 'hot' : 'dot',
                icon: isHot ? '💚' : '☠️'
            });
        }
    });

    const byActorBuff = {};
    effectLogs.forEach(entry => {
        if (!entry.actorId) return;
        const key = `${entry.actorId}::${entry.buffId}`;
        if (!byActorBuff[key]) byActorBuff[key] = [];
        byActorBuff[key].push(entry);
    });

    Object.values(byActorBuff).forEach(entries => {
        let cluster = [];
        const flushCluster = (c) => {
            if (c.length === 0) return;
            let startIdx = c[0].idx;
            for (let b = startIdx - 1; b >= Math.max(0, startIdx - 20); b--) {
                const prevLog = logs[b];
                if (
                    prevLog &&
                    (prevLog.type === 'SKILL_TEXT' || prevLog.type === 'BUFF_APPLY') &&
                    (prevLog.skillId === c[0].buffId || prevLog.buffId === c[0].buffId) &&
                    (prevLog.targetId === c[0].actorId || prevLog.actorId === c[0].actorId)
                ) {
                    startIdx = b;
                    break;
                }
            }
            statusIntervals.push({
                actorId: c[0].actorId,
                start: startIdx,
                end: c[c.length - 1].idx,
                status: {
                    id: c[0].buffId,
                    name: c[0].name,
                    category: c[0].category,
                    icon: c[0].icon
                }
            });
        };

        entries.forEach(e => {
            if (cluster.length === 0) {
                cluster.push(e);
            } else {
                const prev = cluster[cluster.length - 1];
                if (e.idx - prev.idx <= 25) {
                    cluster.push(e);
                } else {
                    flushCluster(cluster);
                    cluster = [e];
                }
            }
        });
        flushCluster(cluster);
    });

    // 2. Fatigue (persists until REST or DEATH)
    const fatigueStarts = {};
    logs.forEach((l, idx) => {
        if (!l || !l.actorId) return;
        if (l.type === 'FATIGUE' || l.type === 'FATIGUE_SKIP') {
            if (!fatigueStarts[l.actorId]) {
                fatigueStarts[l.actorId] = { idx, stage: l.stage };
            }
        } else if (l.type === 'REST' || l.type === 'DEATH' || l.type === 'PLAYER_DEATH' || l.type === 'PLAYER_DEFEAT') {
            if (fatigueStarts[l.actorId]) {
                statusIntervals.push({
                    actorId: l.actorId,
                    start: fatigueStarts[l.actorId].idx,
                    end: idx,
                    status: {
                        id: 'fatigue',
                        name: fatigueStarts[l.actorId].stage === 'EXHAUSTED' ? '力竭 (EXHAUSTED)' : '疲勞 (TIRED)',
                        category: 'fatigue',
                        icon: '💤'
                    }
                });
                delete fatigueStarts[l.actorId];
            }
        }
    });
    Object.entries(fatigueStarts).forEach(([actorId, info]) => {
        statusIntervals.push({
            actorId,
            start: info.idx,
            end: logs.length - 1,
            status: {
                id: 'fatigue',
                name: info.stage === 'EXHAUSTED' ? '力竭 (EXHAUSTED)' : '疲勞 (TIRED)',
                category: 'fatigue',
                icon: '💤'
            }
        });
    });

    // 3. Silenced / Holding (persists until next active combat action or DEATH)
    const silenceStarts = {};
    logs.forEach((l, idx) => {
        if (!l || !l.actorId) return;
        if (l.type === 'SILENCED') {
            if (!silenceStarts[l.actorId]) {
                silenceStarts[l.actorId] = idx;
            }
        } else if (['DAMAGE', 'HEAL', 'COUNTER'].includes(l.type) || (l.type === 'SKILL_TEXT' && l.skillId && l.skillId !== 'default')) {
            if (silenceStarts[l.actorId] && idx > silenceStarts[l.actorId]) {
                statusIntervals.push({
                    actorId: l.actorId,
                    start: silenceStarts[l.actorId],
                    end: idx,
                    status: { id: 'silenced', name: '魔力僵直 (SILENCED)', category: 'silenced', icon: '🤐' }
                });
                delete silenceStarts[l.actorId];
            }
        } else if (l.type === 'DEATH' || l.type === 'PLAYER_DEATH' || l.type === 'PLAYER_DEFEAT') {
            if (silenceStarts[l.actorId]) {
                statusIntervals.push({
                    actorId: l.actorId,
                    start: silenceStarts[l.actorId],
                    end: idx,
                    status: { id: 'silenced', name: '魔力僵直 (SILENCED)', category: 'silenced', icon: '🤐' }
                });
                delete silenceStarts[l.actorId];
            }
        }
    });
    Object.entries(silenceStarts).forEach(([actorId, startIdx]) => {
        statusIntervals.push({
            actorId,
            start: startIdx,
            end: logs.length - 1,
            status: { id: 'silenced', name: '魔力僵直 (SILENCED)', category: 'silenced', icon: '🤐' }
        });
    });

    // 4. Shield / Barrier blocks
    const blockLogs = [];
    logs.forEach((l, idx) => {
        if (!l) return;
        if (l.blocked || l.type === 'BLOCK') {
            const defenderId = l.targetId || l.actorId;
            if (defenderId) blockLogs.push({ idx, defenderId });
        } else if (
            (l.type === 'SKILL_TEXT' || l.type === 'BUFF_APPLY') &&
            (l.skillId === 'sakura_shield' || /shield|barrier|護盾|防護/i.test(l.skillId || ''))
        ) {
            const recipientId = l.targetId || l.actorId;
            if (recipientId) {
                shieldIntervals.push({ actorId: recipientId, start: idx, end: Math.min(logs.length - 1, idx + 10) });
            }
        }
    });

    const byDefender = {};
    blockLogs.forEach(b => {
        if (!byDefender[b.defenderId]) byDefender[b.defenderId] = [];
        byDefender[b.defenderId].push(b.idx);
    });
    Object.entries(byDefender).forEach(([defenderId, indices]) => {
        let cluster = [];
        indices.forEach(idx => {
            if (cluster.length === 0) {
                cluster.push(idx);
            } else {
                const prev = cluster[cluster.length - 1];
                if (idx - prev <= 20) {
                    cluster.push(idx);
                } else {
                    shieldIntervals.push({ actorId: defenderId, start: cluster[0], end: cluster[cluster.length - 1] });
                    cluster = [idx];
                }
            }
        });
        if (cluster.length > 0) {
            shieldIntervals.push({ actorId: defenderId, start: cluster[0], end: cluster[cluster.length - 1] });
        }
    });

    return { statusIntervals, shieldIntervals };
}

/**
 * Builds deterministic frame-by-frame state snapshots from raw battle logs
 * and runs post-processing calibration passes (`calibrateHpWithAnchors` and `markAOEWaves`).
 *
 * @param {Array<object>} logs - Raw combat log entries from the battle report.
 */
export function buildStateSnapshots(logs) {
    engineState.frames = [];
    let currentTurn = 0;
    let lastTurnActorId = null;

    const buffSrc = {};
    const applyLog = [];
    const prefixOwner = {};
    const IGNORE_PREFIX = { basic: 1, imitated: 1, standard: 1 };
    const actorsDeathState = new Map();
    const actorsSummonState = new Map();
    const actorsBondState = new Map();
    const contractCutInCount = new Map();
    const despawnedActors = new Set();
    const { statusIntervals, shieldIntervals } = computeActiveStatusAndShieldIntervals(logs);

    const explicitlySummonedIds = new Set();
    logs.forEach(log => {
        if (log && log.type === 'SUMMON' && log.targetId) {
            explicitlySummonedIds.add(log.targetId);
        }
    });

    // Reset per-actor runtime and statistical counters so buildStateSnapshots is idempotent
    engineState.actors.forEach(actor => {
        actor.currentHp = actor.maxHp;
        actor.turnNumbers = [];
        actor.totalDamageDealt = 0;
        actor.luckDamageDealt = 0;
        actor.totalDamageTaken = 0;
        actor.totalHealingDealt = 0;
        actor.lastUltimateTurn = null;
        actorsSummonState.set(actor.id, actor.initiallySpawned !== false);
    });

    logs.forEach((log, index) => {
        if (!log || typeof log !== 'object') return;

        if (log.actorId && log.skillId) {
            const pre = String(log.skillId).split('_')[0];
            if (!IGNORE_PREFIX[pre] && !prefixOwner[pre]) {
                prefixOwner[pre] = log.actorId;
            }
        }

        const rawValue = Number(log.value) || 0;
        const actualDamage = log.actualDamage != null ? Number(log.actualDamage) : rawValue;
        const isCounterSetup = detectCounterSetup(logs, index, log, rawValue);

        const isSelfDamage =
            log.type === 'DAMAGE' &&
            log.actorId &&
            log.actorId === log.targetId;
        const isEnvironmentalPulse =
            ENVIRONMENTAL_SKILLS.has(log.skillId) ||
            /脈衝波掃過/i.test(log.message || '');

        const frame = {
            index,
            type: log.type,
            actorId: log.actorId,
            targetId: log.targetId,
            opponentId: log.opponentId,
            incomingSkillId: log.incomingSkillId || log.counterSource?.incomingSkillId || null,
            source: log.source || null,
            passiveId: log.passiveId || null,
            stage: log.stage || null,
            diceCheck: log.diceCheck || null,
            value: rawValue,
            actualDamage,
            isCrit: !!log.isCrit,
            isCounter: !!log.isCounter,
            isCounterSetup,
            isSelfDamage,
            isEnvironmentalPulse,
            isAOE: false,
            aoeCasterId: null,
            isAOEFirst: false,
            isAOELast: false,
            rebirthHeal: false,
            isNormalAttack: !!log.isNormalAttack,
            blocked: !!log.blocked || log.type === 'BLOCK',
            actionCancelled: !!log.actionCancelled,
            skillId: log.skillId || 'default',
            skillTier: log.skillTier || 'normal',
            message: log.message || '',
            vfx: [],
            isBeneficial: false,
            hpDeltas: new Map(),
            actorsHpState: new Map(),
            turnNumber: currentTurn,
            actorsDeathState: new Map(),
            actorsSummonState: new Map(),
            isDeathEvent: false,
            deadActorId: null,
            isSummonEvent: false,
            summonedActorId: null,
            isDespawnEvent: false,
            despawnedActorId: null,
            actorsBondState: new Map(),
            actorsStatusState: new Map(),
            actorsShieldState: new Map(),
            contractEvent: null,
            isContractRepeat: false,
            isCoverEvent: false,
            coverDamage: 0,
            coverAttackerId: null,
            holdPositionForCover: false,
            rosarioEvent: null
        };

        const addHpDelta = (id, delta) => {
            if (!id || !delta) return;
            frame.hpDeltas.set(id, (frame.hpDeltas.get(id) || 0) + delta);
        };

        const contractProfile = getContractSkillProfile(frame.skillId);
        const isReactiveCoverText =
            frame.type === 'SKILL_TEXT' &&
            contractProfile &&
            contractProfile.coverRegex.test(frame.message);

        const { isTurnAction, turnActorId } = evaluateTurnOwnership(frame, isReactiveCoverText);
        if (isTurnAction && turnActorId) {
            if (lastTurnActorId !== turnActorId) {
                currentTurn++;
                lastTurnActorId = turnActorId;
                frame.turnNumber = currentTurn;
                const actor = engineState.actors.get(turnActorId);
                if (actor) actor.turnNumbers.push(currentTurn);
            }
        }

        processSummonLifecycle(
            log,
            index,
            logs,
            frame,
            actorsDeathState,
            actorsSummonState,
            explicitlySummonedIds,
            despawnedActors
        );

        // Track debuff application sources so subsequent DoT ticks can be attributed to the caster
        if (log.type === 'BUFF_APPLY') {
            const attacker = engineState.actors.get(log.actorId);
            const victim = engineState.actors.get(log.targetId);
            if (attacker && victim && attacker.side !== victim.side) {
                if (!buffSrc[victim.id]) buffSrc[victim.id] = {};
                buffSrc[victim.id][log.buffId || log.skillId || ''] = attacker.id;
                applyLog.push({ victim: victim.id, actor: attacker.id, msg: String(log.message || '') });
            }
            if (isBeneficialBuffSkill(frame.skillId) && log.targetId) {
                frame.vfx.push('flash-blue');
                frame.isBeneficial = true;
            }
        }

        // Resolve direct combat damage, heals, luck events, and periodic buff effects
        if (['DAMAGE', 'BLOCK', 'COUNTER'].includes(log.type)) {
            if (!frame.isCounterSetup) {
                const target = engineState.actors.get(log.targetId);
                const attacker = engineState.actors.get(log.actorId);
                const realDamage = frame.actualDamage;

                if (target) {
                    if (!target.hideHp) {
                        target.currentHp = Math.max(0, target.currentHp - realDamage);
                        addHpDelta(target.id, -realDamage);
                    }
                    target.totalDamageTaken += realDamage;
                    if (frame.isCrit && !frame.blocked) frame.vfx.push('screen-shake', 'flash-red');
                    if (frame.blocked) frame.vfx.push('shield-block');
                }

                if (attacker && realDamage > 0 && log.type !== 'BLOCK' && attacker.id !== target?.id) {
                    attacker.totalDamageDealt += realDamage;
                }
            }
        } else if (log.type === 'LUCK_EVENT') {
            const opponent = engineState.actors.get(log.opponentId);
            const target = engineState.actors.get(log.targetId);
            const luckValue = frame.value;

            if (opponent) {
                opponent.luckDamageDealt += luckValue;
            }
            if (target) {
                target.totalDamageTaken += luckValue;
                if (!target.hideHp) {
                    target.currentHp = Math.max(0, target.currentHp - luckValue);
                    addHpDelta(target.id, -luckValue);
                }
            }

            frame.vfx.push('luck-drop');
            frame.vfx.push('flash-purple');
        } else if (log.type === 'HEAL') {
            const target = engineState.actors.get(log.targetId || log.actorId);
            if (target) {
                if (!target.hideHp) {
                    target.currentHp = Math.min(target.maxHp, target.currentHp + frame.value);
                    addHpDelta(target.id, frame.value);
                } else {
                    target.currentHp = target.maxHp;
                }
                frame.vfx.push('flash-green');
                frame.isBeneficial = true;
                if (target.currentHp > 0) {
                    actorsDeathState.set(target.id, false);
                }
            }

            const healer = engineState.actors.get(log.actorId);
            const isDecayRestore = /離開毒氣|衰變的傷勢/.test(String(log.message || ''));
            if (healer && !isDecayRestore && frame.value > 0) {
                healer.totalHealingDealt += frame.value;
            }
        } else if (log.type === 'HP_REMAINING') {
            const target = engineState.actors.get(log.actorId);
            // Do not unhide HP for dynamic summons at the end of the battle to prevent spoilers
            if (target && log.maxHp && !target.isSummon) {
                target.maxHp = Number(log.maxHp);
                target.hideHp = false;
            }
        } else if (log.type === 'SP_RECOVER') {
            const target = engineState.actors.get(log.targetId || log.actorId);
            if (target) {
                frame.vfx.push('flash-blue');
                frame.isBeneficial = true;
            }
        } else if (log.type === 'BUFF_EFFECT') {
            const msg = String(log.message || '');
            const target = engineState.actors.get(log.actorId);
            if (target && frame.value) {
                if (log.buffType === 'HOT' || (/恢復|回復/.test(msg) && !/傷害|失去/.test(msg))) {
                    if (!target.hideHp) {
                        target.currentHp = Math.min(target.maxHp, target.currentHp + frame.value);
                        addHpDelta(target.id, frame.value);
                    } else {
                        target.currentHp = target.maxHp;
                    }
                    frame.vfx.push('flash-green');
                    frame.isBeneficial = true;
                    if (target.currentHp > 0) {
                        actorsDeathState.set(target.id, false);
                    }

                    let healerId = null;
                    if (log.buffId && buffSrc[target.id] && buffSrc[target.id][log.buffId]) {
                        healerId = buffSrc[target.id][log.buffId];
                    }
                    const healer = healerId ? engineState.actors.get(healerId) : target;
                    if (healer && frame.value > 0) {
                        healer.totalHealingDealt += frame.value;
                    }
                } else {
                    if (!target.hideHp) {
                        target.currentHp = Math.max(0, target.currentHp - frame.value);
                        addHpDelta(target.id, -frame.value);
                    }
                    target.totalDamageTaken += frame.value;
                    frame.vfx.push('flash-purple');
                    frame.isBeneficial = false;

                    let sourceId = null;
                    if (log.buffId && buffSrc[target.id] && buffSrc[target.id][log.buffId]) {
                        sourceId = buffSrc[target.id][log.buffId];
                    } else {
                        const match = msg.match(/受到\s*(.+?)\s*影響/);
                        const key = match ? match[1] : null;
                        if (key) {
                            for (let k = applyLog.length - 1; k >= 0; k--) {
                                if (applyLog[k].victim === target.id && applyLog[k].msg.includes(key)) {
                                    sourceId = applyLog[k].actor;
                                    break;
                                }
                            }
                        }
                    }

                    if (!sourceId && log.buffId) {
                        const pre = String(log.buffId).split('_')[0];
                        const preActorId = prefixOwner[pre];
                        const preActor = preActorId ? engineState.actors.get(preActorId) : null;
                        if (preActor && preActor.side !== target.side) {
                            sourceId = preActorId;
                        }
                    }

                    if (!sourceId) {
                        const opposingUnits = Array.from(engineState.actors.values()).filter(
                            u => u.side !== target.side && !u.isSummon
                        );
                        if (opposingUnits.length === 1) {
                            sourceId = opposingUnits[0].id;
                        }
                    }

                    const sourceActor = engineState.actors.get(sourceId);
                    if (sourceActor) {
                        sourceActor.totalDamageDealt += frame.value;
                    }
                }
            }
        } else if (log.type === 'MISS') {
            frame.vfx.push('dodge-blink');
        } else if (/TEXT|BUFF_APPLY/.test(String(log.type))) {
            const msg = String(log.message || '');
            const target = engineState.actors.get(log.actorId);
            if (target && !target.hideHp) {
                const healMatch = msg.match(/(?:恢復|回復)了\s*(\d+)\s*(?:HP|點生命)/);
                if (healMatch) {
                    const amount = Number(healMatch[1]);
                    target.currentHp = Math.min(target.maxHp, target.currentHp + amount);
                    addHpDelta(target.id, amount);
                    target.totalHealingDealt += amount;
                }
                const lossMatch = msg.match(/失去了\s*(\d+)\s*(?:HP|點生命)/);
                if (lossMatch) {
                    const amount = Number(lossMatch[1]);
                    target.currentHp = Math.max(0, target.currentHp - amount);
                    addHpDelta(target.id, -amount);
                    target.totalDamageTaken += amount;
                }
            }

            // Handle Contract Skill lifecycle (Propose / Accept / Cover / End)
            if (contractProfile && log.type === 'SKILL_TEXT') {
                processContractSkillLifecycle(
                    frame,
                    contractProfile,
                    msg,
                    target,
                    actorsBondState,
                    contractCutInCount,
                    addHpDelta
                );
            }

            // Handle Cross Finisher mid-skill inscription (e.g., Mother's Rosario 10-hit cross)
            const crossProfile = getCrossFinisherProfile(frame.skillId);
            if (crossProfile && log.type === 'SKILL_TEXT' && crossProfile.inscribeRegex.test(msg)) {
                frame.rosarioEvent = 'INSCRIBE_CROSS';
            }
        }

        // Tag Cross Finisher final piercing hit on DAMAGE or BLOCK frames
        const crossProfile = getCrossFinisherProfile(frame.skillId);
        if (crossProfile && ['DAMAGE', 'BLOCK'].includes(log.type) && crossProfile.pierceRegex.test(frame.message)) {
            frame.rosarioEvent = 'PIERCE_CROSS';
        }

        // Detect narrative unit revival / standing back up (Bosses, players, and multi-phase summons)
        if (
            ['TEXT', 'BOSS_DIALOGUE', 'SKILL_TEXT'].includes(log.type) &&
            REBIRTH_RULES.dialogueRegex.test(frame.message)
        ) {
            let revivingActorId = null;
            if (log.actorId && engineState.actors.has(log.actorId)) {
                revivingActorId = log.actorId;
            } else if (log.targetId && engineState.actors.has(log.targetId)) {
                revivingActorId = log.targetId;
            } else {
                for (const [id, a] of engineState.actors.entries()) {
                    if (a.name && frame.message.includes(a.name) && actorsDeathState.get(id)) {
                        revivingActorId = id;
                        break;
                    }
                }
            }
            if (revivingActorId && actorsDeathState.get(revivingActorId)) {
                actorsDeathState.set(revivingActorId, false);
                const revivingActor = engineState.actors.get(revivingActorId);
                if (revivingActor) {
                    revivingActor.currentHp = revivingActor.maxHp;
                }
            }
        }

        // Safety net: an actor actively acting cannot be dead
        if (
            log.actorId &&
            actorsDeathState.get(log.actorId) &&
            ['DAMAGE', 'MISS', 'COUNTER', 'HEAL', 'SKILL_TEXT', 'BUFF_APPLY'].includes(log.type)
        ) {
            actorsDeathState.set(log.actorId, false);
            const actingActor = engineState.actors.get(log.actorId);
            if (actingActor && actingActor.currentHp <= 0) {
                actingActor.currentHp = actingActor.maxHp;
            }
        }

        if (['DEATH', 'PLAYER_DEATH', 'PLAYER_DEFEAT'].includes(log.type)) {
            const alreadyDead = !!actorsDeathState.get(log.actorId);
            actorsDeathState.set(log.actorId, true);

            if (!alreadyDead) {
                frame.isDeathEvent = true;
                frame.deadActorId = log.actorId;
            }

            const deadActor = engineState.actors.get(log.actorId);
            if (deadActor) {
                deadActor.currentHp = 0;
            }
        }

        engineState.actors.forEach(actor => {
            frame.actorsHpState.set(actor.id, actor.currentHp);
        });

        const activeStatusesForActor = new Map();
        const activeShieldForActor = new Map();

        engineState.actors.forEach(actor => {
            const isDead = !!actorsDeathState.get(actor.id);
            if (isDead) {
                activeStatusesForActor.set(actor.id, []);
                activeShieldForActor.set(actor.id, false);
                return;
            }

            const statuses = [];
            statusIntervals.forEach(interval => {
                if (interval.actorId === actor.id && index >= interval.start && index <= interval.end) {
                    if (!statuses.some(s => s.id === interval.status.id)) {
                        statuses.push(interval.status);
                    }
                }
            });
            activeStatusesForActor.set(actor.id, statuses);

            const hasShield = shieldIntervals.some(
                interval => interval.actorId === actor.id && index >= interval.start && index <= interval.end
            );
            activeShieldForActor.set(actor.id, hasShield);
        });

        frame.actorsDeathState = new Map(actorsDeathState);
        frame.actorsSummonState = new Map(actorsSummonState);
        frame.actorsBondState = new Map(actorsBondState);
        frame.actorsStatusState = activeStatusesForActor;
        frame.actorsShieldState = activeShieldForActor;
        engineState.frames.push(frame);
    });

    calibrateHpWithAnchors(engineState.frames);
    markAOEWaves(engineState.frames);
    engineState.frames.forEach(f => {
        if (f.isAOE) f.holdPositionForCover = false;
    });
    engineState.totalTurns = currentTurn;
}