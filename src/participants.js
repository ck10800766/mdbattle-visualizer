// ==========================================
// FILE: src/participants.js
// ==========================================
/**
 * @fileoverview Participant registration, dynamic summon name inference, and post-battle
 * MVP damage consolidation. Operates purely on `engineState.actors` without DOM dependencies.
 */

import { engineState } from './state.js';
import { ASSET_HOST, DEFAULT_AVATAR_URL } from './constants.js';

/**
 * Factory helper to create a standardized actor state entity.
 * @param {object} config - Actor configuration parameters.
 * @param {string} config.id - Unique actor identifier (`userId`, `entityId`, or `_id`).
 * @param {string} [config.name='Unknown'] - Display name shown on the stage card and combat log.
 * @param {'left'|'right'} [config.side='left'] - Team side (`'left'` for players/allies, `'right'` for enemies).
 * @param {number} [config.maxHp=1] - Initial maximum HP capacity.
 * @param {boolean} [config.hideHp=false] - Whether the HP bar should remain hidden (used for dynamic summons without explicit HP).
 * @param {string} [config.avatar=DEFAULT_AVATAR_URL] - Resolved full URL to the actor's avatar image.
 * @param {boolean} [config.isSummon=false] - Whether this unit is a summoned entity.
 * @param {string|null} [config.ownerId=null] - Actor ID of the summoner (used to attribute summon damage toward MVP).
 * @param {boolean} [config.initiallySpawned=true] - Whether the unit is present on the battlefield at frame 0.
 * @returns {object} Standardized actor entity stored in `engineState.actors`.
 */
export function createActorEntity({
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
        totalHealingDealt: 0,
        lastUltimateTurn: null
    };
}

/**
 * Infers the display name of a dynamically summoned unit by inspecting structured combat logs
 * (death notices, spoken dialogue prefixes, action prefixes, or damage targets) before falling
 * back to tokenizing the `SUMMON` log message itself.
 *
 * @param {Array<object>} logs - Raw combat log array from the battle report.
 * @param {number} summonIndex - Index of the `SUMMON` log entry where the unit appeared.
 * @param {string} summonId - Unique entity ID of the summoned unit (`log.targetId`).
 * @param {string} ownerName - Display name of the summoner (`log.actorId`), excluded from prefix matches.
 * @returns {string} Inferred display name for the summoned unit.
 */
export function inferSummonName(logs, summonIndex, summonId, ownerName) {
    const summonLog = logs[summonIndex];
    if (!summonLog) return 'Summon';

    const explicitName = summonLog.targetName || summonLog.summonName || summonLog.characterName || summonLog.name;
    if (explicitName) return String(explicitName).trim();

    // 1. Inspect subsequent structured logs involving this summonId for unambiguous name patterns
    for (let i = summonIndex + 1; i < logs.length; i++) {
        const log = logs[i];
        if (!log || typeof log !== 'object') continue;
        const msg = String(log.message || '');

        // 1a. Death of this summon (<Name> 倒下了！)
        if (log.actorId === summonId && ['DEATH', 'PLAYER_DEATH', 'PLAYER_DEFEAT'].includes(log.type)) {
            const deathMatch = msg.match(/^\s*(\S+?)\s+倒下了/);
            if (deathMatch && deathMatch[1] !== ownerName) return deathMatch[1];
        }

        // 1b. Spoken dialogue or narrative quote (<Name>：「...」 or <Name> 低聲說：「...」)
        if (log.actorId === summonId && ['DIALOGUE', 'BOSS_DIALOGUE', 'TEXT', 'SKILL_TEXT'].includes(log.type)) {
            const dialogueMatch = msg.match(/([^\s，,。！!：「]+)\s*(?:[：:]\s*[「『"“]|低聲說[：:]\s*[「『"“])/);
            if (dialogueMatch && dialogueMatch[1] !== ownerName) return dialogueMatch[1];
        }

        // 1c. Target of single-target attack, projectile, or heal
        if (log.targetId === summonId && ['DAMAGE', 'BLOCK', 'HEAL'].includes(log.type)) {
            const targetMatch = msg.match(/(?:對|\S{1,4}向|\S{1,4}使)\s+(\S+?)(?:[，,。！!、\s]|造成|回復|恢復)/);
            if (targetMatch && targetMatch[1] !== ownerName) {
                const token = targetMatch[1].replace(/^[「『\[【](.*?)[」』\]】]$/, '$1');
                const isExistingNonSummon = Array.from(engineState.actors.values()).some(a => !a.isSummon && a.name === token);
                if (token && token !== ownerName && !isExistingNonSummon) return token;
            }
        }

        // 1e. Active combat action by the summon (strictly exclude LUCK_EVENT, TEXT, DEATH)
        if (log.actorId === summonId && ['DAMAGE', 'BLOCK', 'MISS', 'HEAL', 'SKILL_TEXT', 'BUFF_APPLY'].includes(log.type)) {
            const actorPrefixMatch = msg.match(/^\s*([^，,。！!：「\s]+)\s+/);
            if (actorPrefixMatch) {
                const name = actorPrefixMatch[1];
                if (name.length > 1 && !/^(?:對|向|在|從|由|被|使|與|和|給|第)$/.test(name)) {
                    const isExistingNonSummon = Array.from(engineState.actors.values()).some(a => !a.isSummon && a.name === name);
                    if (!isExistingNonSummon && name !== ownerName) {
                        return name;
                    }
                }
            }
        }
    }

    // 2. Direct entrance pattern from SUMMON log message (e.g. "同人的影分身 從白煙裡滾了出來。", "荒坂特勤 從電梯裡走了出來。")
    const summonMsg = String(summonLog.message || '').trim();
    const summonEntranceMatch = summonMsg.match(/(?:[，,。！!、\s]|^)(?:\S+?的\s+)?([^\s，,。！!]+)\s+(?:從|走進|走了出來|盤腿|趕到|趕來|弓著背|倒掛|站起身|出現在|降臨|現身|按著)/);
    if (summonEntranceMatch && summonEntranceMatch[1] !== ownerName) {
        return summonEntranceMatch[1];
    }

    // 3. Fallback: tokenize the SUMMON log message itself
    const whitespaceTokens = summonMsg.split(/\s+/);
    if (whitespaceTokens.length >= 2) {
        const candidate = whitespaceTokens[whitespaceTokens.length - 2].split(/[，,。！!、]/).pop();
        if (candidate && candidate !== ownerName) {
            return candidate;
        }
    }

    return 'Summon';
}

/**
 * Parses report participants (`players` and `enemies`) and pre-registers any dynamically summoned
 * units into `engineState.actors`.
 *
 * Design Note:
 * Dynamic summons that do not have explicit `stats.hp > 1` in `participants` always keep
 * `hideHp = true` so that end-of-battle `HP_REMAINING` logs do not prematurely reveal whether
 * the summon survived the fight.
 *
 * @param {object} reportData - Complete battle report payload.
 */
export function parseParticipants(reportData) {
    engineState.actors.clear();
    const p = reportData.participants || {};
    const logs = reportData.logs || [];
    const fallbackBossImage = reportData.boss ? reportData.boss.imagePath : null;

    // Identify all target IDs that are spawned mid-battle via an explicit SUMMON log entry
    const summonedIds = new Set();
    logs.forEach(log => {
        if (log && log.type === 'SUMMON' && log.targetId) {
            summonedIds.add(log.targetId);
        }
    });

    const resolveAvatarUrl = (avatarPath) => {
        if (!avatarPath) return DEFAULT_AVATAR_URL;
        if (/^https?:\/\//i.test(avatarPath)) return avatarPath;
        return `${ASSET_HOST}${avatarPath}`;
    };

    // Register left-side player party members
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
            avatar: resolveAvatarUrl(avatarPath),
            isSummon,
            ownerId: player.summonerId || null,
            initiallySpawned: !isSummon
        }));
    });

    // Register right-side enemy / boss entities
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
            avatar: resolveAvatarUrl(avatarPath),
            isSummon,
            ownerId: enemy.summonerId || null,
            initiallySpawned: !isSummon
        }));
    });

    // Pre-register dynamic summons appearing only in logs with hideHp: true
    logs.forEach((log, index) => {
        if (!log || log.type !== 'SUMMON' || !log.targetId) return;

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
                ownerId: log.actorId || null,
                initiallySpawned: false
            }));
        }
    });
}

/**
 * Aggregates player and summon combat statistics to determine the party MVP.
 * Damage dealt and taken by a summoned unit are consolidated into its summoner's totals
 * if the summoner is a registered left-side participant.
 *
 * @returns {{ consolidated: Map<string, { actor: object, totalOutput: number, totalTaken: number }>, mvp: object|null, maxTotalDamage: number }}
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
                    totalTaken: 0,
                    totalHealing: 0
                });
            }

            const stats = consolidated.get(targetId);
            stats.totalOutput += (actor.totalDamageDealt || 0) + (actor.luckDamageDealt || 0);
            stats.totalTaken += actor.totalDamageTaken || 0;
            stats.totalHealing += actor.totalHealingDealt || 0;
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

