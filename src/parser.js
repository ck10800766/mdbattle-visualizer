// src/parser.js
import { engineState } from './state.js';

const KNOWN_AOE_SKILLS = new Set([
    'genji_fan_of_blades',
    'inspector_blanket',
    'sylphy_that_day_wind',
    'patriot_dust',
    'patriot_sacrifice',
    'hoarfrost_stomp',
    'guerrilla_mortar_shell',
    'guerrilla_mortar_splash'
]);

function normalizeAOESkillGroup(skillId) {
    if (!skillId) return 'default';
    if (skillId.startsWith('guerrilla_mortar_')) return 'guerrilla_mortar';
    return skillId;
}

function markAOEWaves(frames) {
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

        if (!casterId || !rawSkillId) {
            i++;
            continue;
        }

        if (rawSkillId === 'genji_dragonblade' || rawSkillId === 'genji_dragonblade_sweep') {
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
 * Calibrates actor HP timelines using final HP_REMAINING / DEATH anchors.
 * Detects hidden Phase 2 HP regeneration (e.g., Patriot kneeling at 1 HP and reviving)
 * even when the boss later dies or ends with HP_REMAINING.
 */
function calibrateHpWithAnchors(frames) {
    engineState.actors.forEach(actor => {
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

        // Find the first frame where forward-calculated HP dropped to <= 1
        let lowHpStartIndex = -1;
        for (let i = 0; i <= anchorIndex; i++) {
            const hp = frames[i].actorsHpState.get(actor.id);
            if (hp != null && hp <= 1) {
                lowHpStartIndex = i;
                break;
            }
        }

        if (lowHpStartIndex < 0) {
            // No low-HP phase occurred; still ensure anchor frame and subsequent frames match anchorHp
            for (let i = anchorIndex; i < frames.length; i++) {
                frames[i].actorsHpState.set(actor.id, anchorHp);
            }
            return;
        }

        const hpAtLowStart = frames[lowHpStartIndex].actorsHpState.get(actor.id) ?? 0;

        // Sum all HP deltas after lowHpStartIndex up to anchorIndex (unclamped)
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

        // If there is no hidden phase-transition heal, simply sync anchor frames and return
        if (Math.abs(missingHeal) <= 1) {
            for (let i = anchorIndex; i < frames.length; i++) {
                frames[i].actorsHpState.set(actor.id, anchorHp);
            }
            return;
        }

        const searchLimit = firstPostRebirthDeltaIndex !== -1 ? firstPostRebirthDeltaIndex : anchorIndex;

        // Locate the narrative frame where the Boss stands back up / enters Phase 2
        let rebirthFrameIndex = -1;
        for (let i = lowHpStartIndex + 1; i <= searchLimit; i++) {
            const f = frames[i];
            if (
                f.actorId === actor.id &&
                ['TEXT', 'BOSS_DIALOGUE', 'SKILL_TEXT'].includes(f.type) &&
                /站了起來|進軍|重生|甦醒|恢復|第二階段/.test(f.message)
            ) {
                rebirthFrameIndex = i;
                break;
            }
        }

        // Fallback 1: first BLOCK frame mentioning "重生"
        if (rebirthFrameIndex === -1) {
            for (let i = lowHpStartIndex + 1; i <= searchLimit; i++) {
                const f = frames[i];
                if (f.targetId === actor.id && f.type === 'BLOCK' && f.message.includes('重生')) {
                    rebirthFrameIndex = i;
                    break;
                }
            }
        }

        // Fallback 2: the frame right before or at the first post-rebirth HP change
        if (rebirthFrameIndex === -1) {
            rebirthFrameIndex = searchLimit;
        }

        // Walk backward from anchorIndex down to rebirthFrameIndex using recorded hpDeltas
        const backwardHp = new Array(anchorIndex + 1);
        let b = anchorHp;
        for (let i = anchorIndex; i >= rebirthFrameIndex; i--) {
            backwardHp[i] = b;
            const delta = frames[i].hpDeltas?.get(actor.id) || 0;
            b = Math.max(0, Math.min(actor.maxHp, b - delta));
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

export function parseParticipants(reportData) {
    engineState.actors.clear();
    const p = reportData.participants || {};
    const fallbackBossImage = reportData.boss ? reportData.boss.imagePath : null;

    const summonedIds = new Set();
    (reportData.logs || []).forEach(log => {
        if (log && log.type === 'SUMMON' && log.targetId) {
            summonedIds.add(log.targetId);
        }
    });

    (p.players || []).forEach(player => {
        const id = player.userId || player.entityId || player._id;
        const name = player.characterName || player.name || 'Unknown';
        const maxHp = Number(player.stats?.hp) || 1;
        const avatarPath = player.imagePath;
        const isSummon = !!player.summonerId || summonedIds.has(id);

        engineState.actors.set(id, {
            id,
            name,
            side: 'left',
            maxHp,
            currentHp: maxHp,
            avatar: avatarPath ? `https://mydoujin.online${avatarPath}` : 'https://via.placeholder.com/150',
            isSummon,
            ownerId: player.summonerId || null,
            initiallySpawned: !summonedIds.has(id),
            turnNumbers: [],
            totalDamageDealt: 0,
            luckDamageDealt: 0,
            totalDamageTaken: 0,
            lastUltimateTurn: null
        });
    });

    (p.enemies || []).forEach(enemy => {
        const id = enemy.userId || enemy.entityId || enemy._id;
        const name = enemy.characterName || enemy.name || 'Unknown';
        const maxHp = Number(enemy.stats?.hp) || 1;

        let avatarPath = enemy.imagePath;
        if ((!avatarPath || avatarPath.includes('default-boss.webp')) && fallbackBossImage) {
            avatarPath = fallbackBossImage;
        }

        const isSummon = !!enemy.summonerId || summonedIds.has(id);

        engineState.actors.set(id, {
            id,
            name,
            side: 'right',
            maxHp,
            currentHp: maxHp,
            avatar: avatarPath ? `https://mydoujin.online${avatarPath}` : 'https://via.placeholder.com/150',
            isSummon,
            ownerId: enemy.summonerId || null,
            initiallySpawned: !summonedIds.has(id),
            turnNumbers: [],
            totalDamageDealt: 0,
            luckDamageDealt: 0,
            totalDamageTaken: 0,
            lastUltimateTurn: null
        });
    });
}

export function buildStateSnapshots(logs) {
    engineState.frames = [];
    let currentTurn = 0;
    let lastTurnActorId = null;

    const buffSrc = {};
    const applyLog = [];
    const actorsDeathState = new Map();
    const actorsSummonState = new Map();

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
                const x = logs[j];
                if (
                    x &&
                    (x.type === 'DAMAGE' || x.type === 'BLOCK') &&
                    x.isCounter &&
                    (Number(x.value) === rawValue || x.actorId === log.actorId)
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
        const isEnvironmentalPulse = log.skillId === 'originium_altar';

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
            summonedActorId: null
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
            const summonNameMatch = String(log.message || '').match(/^\s*(\S+?)\s/);
            const summonName = summonNameMatch ? summonNameMatch[1] : 'Summon';

            if (!engineState.actors.has(log.targetId)) {
                engineState.actors.set(log.targetId, {
                    id: log.targetId,
                    name: summonName,
                    side: owner ? owner.side : 'left',
                    maxHp: 1,
                    currentHp: 1,
                    avatar: owner ? owner.avatar : 'https://via.placeholder.com/150',
                    isSummon: true,
                    ownerId: log.actorId,
                    initiallySpawned: false,
                    turnNumbers: [],
                    totalDamageDealt: 0,
                    luckDamageDealt: 0,
                    totalDamageTaken: 0,
                    lastUltimateTurn: null
                });
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
                    target.currentHp = Math.max(0, target.currentHp - realDamage);
                    target.totalDamageTaken += realDamage;
                    addHpDelta(target.id, -realDamage);
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
                target.currentHp = Math.max(0, target.currentHp - luckValue);
                addHpDelta(target.id, -luckValue);
            }

            frame.vfx.push('luck-drop');
            if (frame.actionCancelled) frame.vfx.push('break-stamp');
        } else if (log.type === 'HEAL') {
            const target = engineState.actors.get(log.targetId || log.actorId);
            if (target) {
                target.currentHp = Math.min(target.maxHp, target.currentHp + frame.value);
                addHpDelta(target.id, frame.value);
                frame.vfx.push('flash-green');
                frame.isBeneficial = true;
                if (target.currentHp > 0) {
                    actorsDeathState.set(target.id, false);
                }
            }
        } else if (log.type === 'HP_REMAINING') {
            // Only update maxHp if provided; do NOT overwrite target.currentHp here so
            // calibrateHpWithAnchors can accurately detect phase-transition discrepancies!
            const target = engineState.actors.get(log.actorId);
            if (target && log.maxHp) {
                target.maxHp = Number(log.maxHp);
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
                    target.currentHp = Math.min(target.maxHp, target.currentHp + frame.value);
                    addHpDelta(target.id, frame.value);
                    frame.vfx.push('flash-green');
                    frame.isBeneficial = true;
                    if (target.currentHp > 0) {
                        actorsDeathState.set(target.id, false);
                    }
                } else {
                    target.currentHp = Math.max(0, target.currentHp - frame.value);
                    target.totalDamageTaken += frame.value;
                    addHpDelta(target.id, -frame.value);
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
            if (target) {
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
        engineState.frames.push(frame);
    });

    calibrateHpWithAnchors(engineState.frames);
    markAOEWaves(engineState.frames);
    engineState.totalTurns = currentTurn;
}

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