// ==========================================
// FILE: src/parser.js
// ==========================================
import { engineState } from './state.js';
import { markAOEWaves, calibrateHpWithAnchors } from './calibrator.js';
import {
    ENVIRONMENTAL_SKILLS,
    CONTRACT_SKILL_PROFILES,
    CROSS_FINISHER_PROFILES
} from './profiles.js';

const DEFAULT_AVATAR_URL = 'https://via.placeholder.com/150';
const ASSET_HOST = 'https://mydoujin.online';

/**
 * Factory helper to create a standardized actor state entity.
 * @param {object} config - Actor configuration parameters.
 * @returns {object} Standardized actor entity.
 */
function createActorEntity({
    id,
    name = 'Unknown',
    side = 'left',
    maxHp = 1,
    hideHp = false,
    avatar = DEFAULT_AVATAR_URL,
    isSummon = false,
    ownerId = null,
    initiallySpawned = true
}) {
    return {
        id,
        name,
        side,
        maxHp,
        currentHp: maxHp,
        hideHp,
        avatar,
        isSummon,
        ownerId,
        initiallySpawned,
        turnNumbers: [],
        totalDamageDealt: 0,
        luckDamageDealt: 0,
        totalDamageTaken: 0,
        lastUltimateTurn: null
    };
}

/**
 * Infers the display name of a summoned unit by inspecting structured combat logs
 * (death, dialogue, actor prefix, damage target) before falling back to tokenizing the SUMMON message.
 * @param {Array<object>} logs - Raw combat log array.
 * @param {number} summonIndex - Index of the SUMMON log entry.
 * @param {string} summonId - Unique entity ID of the summoned unit.
 * @param {string} ownerName - Display name of the summoner.
 * @returns {string} Inferred display name for the summon.
 */
function inferSummonName(logs, summonIndex, summonId, ownerName) {
    const summonLog = logs[summonIndex];
    if (!summonLog) return 'Summon';

    const explicitName = summonLog.targetName || summonLog.summonName || summonLog.characterName || summonLog.name;
    if (explicitName) return String(explicitName).trim();

    // 1. Inspect subsequent structured logs involving this summonId
    for (let i = summonIndex + 1; i < logs.length; i++) {
        const log = logs[i];
        if (!log || typeof log !== 'object') continue;
        const msg = String(log.message || '');

        if (log.actorId === summonId) {
            if (['DEATH', 'PLAYER_DEATH', 'PLAYER_DEFEAT'].includes(log.type)) {
                const deathMatch = msg.match(/^\s*(\S+?)\s+倒下了/);
                if (deathMatch) return deathMatch[1];
            }
            const dialogueMatch = msg.match(/^\s*([^：「\s]+)\s*：「/);
            if (dialogueMatch) return dialogueMatch[1];

            const actorPrefixMatch = msg.match(/^\s*([^，,。！!：「\s]+)\s+/);
            if (actorPrefixMatch && actorPrefixMatch[1] !== ownerName) {
                return actorPrefixMatch[1];
            }
        }

        if (log.targetId === summonId && ['DAMAGE', 'BLOCK', 'HEAL'].includes(log.type)) {
            const targetMatch = msg.match(/對\s+(\S+?)\s+造成/);
            if (targetMatch) return targetMatch[1];
        }
    }

    // 2. Fallback: tokenize the SUMMON log message itself
    const summonMsg = String(summonLog.message || '').trim();
    const whitespaceTokens = summonMsg.split(/\s+/);
    if (whitespaceTokens.length >= 3) {
        const candidate = whitespaceTokens[whitespaceTokens.length - 2]
            .split(/[，,。！!、的]/).pop();
        if (candidate && candidate !== ownerName) {
            return candidate;
        }
    }

    return 'Summon';
}

/**
 * Parses report participants and pre-registers any dynamically summoned units into engineState.actors.
 * @param {object} reportData - Battle report payload.
 */
export function parseParticipants(reportData) {
    engineState.actors.clear();
    const p = reportData.participants || {};
    const logs = reportData.logs || [];
    const fallbackBossImage = reportData.boss ? reportData.boss.imagePath : null;

    const summonedIds = new Set();
    logs.forEach(log => {
        if (log && log.type === 'SUMMON' && log.targetId) {
            summonedIds.add(log.targetId);
        }
    });

    (p.players || []).forEach(player => {
        const id = player.userId || player.entityId || player._id;
        const name = player.characterName || player.name || 'Unknown';
        const rawHp = Number(player.stats?.hp);
        const isSummon = !!player.summonerId || summonedIds.has(id);
        const hideHp = isSummon && !(rawHp > 1);
        const maxHp = rawHp > 0 ? rawHp : 1;
        const avatarPath = player.imagePath;

        engineState.actors.set(id, createActorEntity({
            id,
            name,
            side: 'left',
            maxHp,
            hideHp,
            avatar: avatarPath ? `${ASSET_HOST}${avatarPath}` : DEFAULT_AVATAR_URL,
            isSummon,
            ownerId: player.summonerId || null,
            initiallySpawned: !summonedIds.has(id)
        }));
    });

    (p.enemies || []).forEach(enemy => {
        const id = enemy.userId || enemy.entityId || enemy._id;
        const name = enemy.characterName || enemy.name || 'Unknown';
        const rawHp = Number(enemy.stats?.hp);
        const isSummon = !!enemy.summonerId || summonedIds.has(id);
        const hideHp = isSummon && !(rawHp > 1);
        const maxHp = rawHp > 0 ? rawHp : 1;

        let avatarPath = enemy.imagePath;
        if ((!avatarPath || avatarPath.includes('default-boss.webp')) && fallbackBossImage) {
            avatarPath = fallbackBossImage;
        }

        engineState.actors.set(id, createActorEntity({
            id,
            name,
            side: 'right',
            maxHp,
            hideHp,
            avatar: avatarPath ? `${ASSET_HOST}${avatarPath}` : DEFAULT_AVATAR_URL,
            isSummon,
            ownerId: enemy.summonerId || null,
            initiallySpawned: !summonedIds.has(id)
        }));
    });

    // Pre-register dynamic summons so initial DOM creation and frame 0 snapshots include them
    logs.forEach((log, index) => {
        if (!log || log.type !== 'SUMMON' || !log.targetId) return;

        const owner = engineState.actors.get(log.actorId);
        const explicitHp = Number(log.maxHp || log.hp || log.stats?.hp);
        const hasExplicitHp = explicitHp > 1;
        const maxHp = hasExplicitHp ? explicitHp : 1;
        const summonName = inferSummonName(logs, index, log.targetId, owner?.name || '');

        if (!engineState.actors.has(log.targetId)) {
            engineState.actors.set(log.targetId, createActorEntity({
                id: log.targetId,
                name: summonName,
                side: owner ? owner.side : 'left',
                maxHp,
                hideHp: !hasExplicitHp,
                avatar: owner ? owner.avatar : DEFAULT_AVATAR_URL,
                isSummon: true,
                ownerId: log.actorId || null,
                initiallySpawned: false
            }));
        }
    });
}

/**
 * Builds deterministic frame-by-frame state snapshots from raw battle logs
 * and runs post-processing calibration passes.
 * @param {Array<object>} logs - Raw combat log entries.
 */
export function buildStateSnapshots(logs) {
    engineState.frames = [];
    let currentTurn = 0;
    let lastTurnActorId = null;

    const buffSrc = {};
    const applyLog = [];
    const actorsDeathState = new Map();
    const actorsSummonState = new Map();
    const actorsBondState = new Map();
    const contractCutInCount = new Map();

    engineState.actors.forEach(actor => {
        actorsSummonState.set(actor.id, actor.initiallySpawned !== false);
    });

    logs.forEach((log, index) => {
        if (!log || typeof log !== 'object') return;

        const rawValue = Number(log.value) || 0;
        const actualDamage = log.actualDamage != null ? Number(log.actualDamage) : rawValue;

        let isCounterSetup = false;
        if (log.type === 'COUNTER') {
            for (let j = index + 1; j < Math.min(logs.length, index + 6); j++) {
                const nextLog = logs[j];
                if (
                    nextLog &&
                    (nextLog.type === 'DAMAGE' || nextLog.type === 'BLOCK') &&
                    nextLog.isCounter &&
                    (Number(nextLog.value) === rawValue || nextLog.actorId === log.actorId)
                ) {
                    isCounterSetup = true;
                    break;
                }
            }
        }

        const isSelfDamage =
            log.type === 'DAMAGE' &&
            log.actorId &&
            log.actorId === log.targetId;
        const isEnvironmentalPulse = ENVIRONMENTAL_SKILLS.has(log.skillId);

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
            actorsBondState: new Map(),
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

        let isTurnAction = false;
        if (['SKILL_TEXT', 'BOSS_DIALOGUE'].includes(frame.type)) {
            isTurnAction = true;
        } else if (
            ['DAMAGE', 'MISS', 'BLOCK'].includes(frame.type) &&
            !frame.isCounter &&
            !frame.isSelfDamage &&
            !frame.isEnvironmentalPulse &&
            frame.source !== 'DIRECT'
        ) {
            isTurnAction = true;
        }

        if (isTurnAction && frame.actorId) {
            if (lastTurnActorId !== frame.actorId) {
                currentTurn++;
                lastTurnActorId = frame.actorId;
                frame.turnNumber = currentTurn;
                const actor = engineState.actors.get(frame.actorId);
                if (actor) actor.turnNumbers.push(currentTurn);
            }
        }

        if (log.type === 'SUMMON' && log.targetId) {
            const owner = engineState.actors.get(log.actorId);
            const explicitHp = Number(log.maxHp || log.hp || log.stats?.hp);
            const hasExplicitHp = explicitHp > 1;
            const maxHp = hasExplicitHp ? explicitHp : 1;
            const summonName = inferSummonName(logs, index, log.targetId, owner?.name || '');

            if (!engineState.actors.has(log.targetId)) {
                engineState.actors.set(log.targetId, createActorEntity({
                    id: log.targetId,
                    name: summonName,
                    side: owner ? owner.side : 'left',
                    maxHp,
                    hideHp: !hasExplicitHp,
                    avatar: owner ? owner.avatar : DEFAULT_AVATAR_URL,
                    isSummon: true,
                    ownerId: log.actorId,
                    initiallySpawned: false
                }));
            } else {
                const summonActor = engineState.actors.get(log.targetId);
                summonActor.currentHp = summonActor.maxHp;
                actorsDeathState.set(log.targetId, false);
            }
            actorsSummonState.set(log.targetId, true);
            frame.isSummonEvent = true;
            frame.summonedActorId = log.targetId;
        }

        if (log.type === 'BUFF_APPLY') {
            const attacker = engineState.actors.get(log.actorId);
            const victim = engineState.actors.get(log.targetId);
            if (attacker && victim && attacker.side !== victim.side) {
                if (!buffSrc[victim.id]) buffSrc[victim.id] = {};
                buffSrc[victim.id][log.buffId || log.skillId || ''] = attacker.id;
                applyLog.push({ victim: victim.id, actor: attacker.id, msg: String(log.message || '') });
            }
        }

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
            if (frame.actionCancelled) frame.vfx.push('break-stamp');
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
        } else if (log.type === 'HP_REMAINING') {
            const target = engineState.actors.get(log.actorId);
            if (target && log.maxHp) {
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
                }
                const lossMatch = msg.match(/失去了\s*(\d+)\s*(?:HP|點生命)/);
                if (lossMatch) {
                    const amount = Number(lossMatch[1]);
                    target.currentHp = Math.max(0, target.currentHp - amount);
                    addHpDelta(target.id, -amount);
                }
            }

            // Handle Contract Skill lifecycle (Propose / Accept / Cover / End)
            const contractProfile = CONTRACT_SKILL_PROFILES[frame.skillId];
            if (contractProfile && log.type === 'SKILL_TEXT') {
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

                    // Locate the enemy actor who triggered this cover event
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
                            // Keep the attacker in front of the ally on the preceding hit so the cover clash connects seamlessly
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

            // Handle Cross Finisher mid-skill inscription (e.g., Mother's Rosario 10-hit cross)
            const crossProfile = CROSS_FINISHER_PROFILES[frame.skillId];
            if (crossProfile && log.type === 'SKILL_TEXT' && crossProfile.inscribeRegex.test(msg)) {
                frame.rosarioEvent = 'INSCRIBE_CROSS';
            }
        }

        // Tag Cross Finisher final piercing hit on DAMAGE frames
        const crossProfile = CROSS_FINISHER_PROFILES[frame.skillId];
        if (crossProfile && log.type === 'DAMAGE' && crossProfile.pierceRegex.test(frame.message)) {
            frame.rosarioEvent = 'PIERCE_CROSS';
        }

        if (['DEATH', 'PLAYER_DEATH', 'PLAYER_DEFEAT'].includes(log.type)) {
            const alreadyDead = !!actorsDeathState.get(log.actorId);
            actorsDeathState.set(log.actorId, true);

            if (!alreadyDead) {
                frame.isDeathEvent = true;
                frame.deadActorId = log.actorId;
            }

            const deadActor = engineState.actors.get(log.actorId);
            if (deadActor) deadActor.currentHp = 0;
        }

        engineState.actors.forEach(actor => {
            frame.actorsHpState.set(actor.id, actor.currentHp);
        });

        frame.actorsDeathState = new Map(actorsDeathState);
        frame.actorsSummonState = new Map(actorsSummonState);
        frame.actorsBondState = new Map(actorsBondState);
        engineState.frames.push(frame);
    });

    calibrateHpWithAnchors(engineState.frames);
    markAOEWaves(engineState.frames);
    engineState.frames.forEach(f => {
        if (f.isAOE) f.holdPositionForCover = false;
    });
    engineState.totalTurns = currentTurn;
}

/**
 * Aggregates player and summon combat statistics to determine the party MVP.
 * @returns {{ consolidated: Map<string, object>, mvp: object|null, maxTotalDamage: number }}
 */
export function getConsolidatedStats() {
    let mvp = null;
    let maxTotalDamage = 0;
    const consolidated = new Map();

    engineState.actors.forEach(actor => {
        if (actor.side === 'left') {
            const baseId = actor.isSummon ? actor.ownerId : actor.id;
            const targetId = engineState.actors.has(baseId) ? baseId : actor.id;

            if (!consolidated.has(targetId)) {
                consolidated.set(targetId, {
                    actor: engineState.actors.get(targetId),
                    totalOutput: 0,
                    totalTaken: 0
                });
            }

            const stats = consolidated.get(targetId);
            stats.totalOutput += (actor.totalDamageDealt || 0) + (actor.luckDamageDealt || 0);
            stats.totalTaken += actor.totalDamageTaken || 0;
        }
    });

    consolidated.forEach(stats => {
        if (!stats.actor.isSummon && stats.totalOutput > maxTotalDamage) {
            maxTotalDamage = stats.totalOutput;
            mvp = stats.actor;
        }
    });

    return { consolidated, mvp, maxTotalDamage };
}