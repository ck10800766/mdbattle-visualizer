// ==========================================
// FILE: src/reportIO.js
// ==========================================
/**
 * @fileoverview Battle Report JSON export, offline import, and drag-and-drop loader.
 * Preserves full participant metadata (including supplementary HP and avatars) inside
 * exported JSON files so battle reports remain 100% replayable even after server expiration.
 */

import { ASSET_HOST } from './constants.js';
import { engineState } from './state.js';

/**
 * Recursively searches a JSON object (up to depth 3) for a valid battle report payload containing `logs[]`.
 *
 * @param {object} obj - Candidate JSON object.
 * @param {number} [depth=0] - Current recursion depth.
 * @returns {object|null} Extracted battle payload or null if not found.
 */
export function extractBattlePayload(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 3) return null;
    if (Array.isArray(obj.logs) && obj.logs.some(l => l && typeof l === 'object')) {
        return obj;
    }
    for (const key of Object.keys(obj)) {
        const val = obj[key];
        if (val && typeof val === 'object' && !Array.isArray(val)) {
            const found = extractBattlePayload(val, depth + 1);
            if (found) return found;
        }
    }
    return null;
}

/**
 * Sanitizes a string for safe use in a downloaded filename.
 *
 * @param {string} name - Raw actor or title string.
 * @returns {string} Filename-safe string.
 */
function sanitizeFilenameSegment(name) {
    return String(name || 'unknown')
        .replace(/[\\/:*?"<>|\s]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 24) || 'unit';
}

/**
 * Converts a full avatar URL back to a relative `imagePath` when hosted on `ASSET_HOST`,
 * or preserves the URL if external.
 *
 * @param {string} avatarUrl - Full avatar URL stored on an actor entity.
 * @returns {string|null} Relative or external path for `participants` serialization.
 */
function toSerializableImagePath(avatarUrl) {
    if (!avatarUrl || typeof avatarUrl !== 'string') return null;
    if (avatarUrl.startsWith(ASSET_HOST)) {
        return avatarUrl.slice(ASSET_HOST.length);
    }
    return avatarUrl;
}

/**
 * Builds a complete, self-contained battle report object from `engineState.lastReportData`
 * and `engineState.actors`, ensuring that `participants.players` and `participants.enemies`
 * contain calibrated `maxHp` and `imagePath` values for permanent offline replay.
 *
 * @returns {object|null} Serializable battle report payload or null if no report is loaded.
 */
export function buildExportableReportPayload() {
    if (!engineState.lastReportData || !Array.isArray(engineState.lastReportData.logs)) {
        return null;
    }

    const raw = engineState.lastReportData;
    const hasPlayers = Array.isArray(raw.participants?.players) && raw.participants.players.length > 0;
    const hasEnemies = Array.isArray(raw.participants?.enemies) && raw.participants.enemies.length > 0;

    let participants = raw.participants ? structuredClone(raw.participants) : { players: [], enemies: [] };

    // If participants were missing, synthesize them from engineState.actors;
    // otherwise enrich any existing entries that lack stats.hp or imagePath
    if (!hasPlayers && !hasEnemies && engineState.actors.size > 0) {
        const players = [];
        const enemies = [];
        engineState.actors.forEach(actor => {
            const entry = {
                userId: actor.id,
                characterName: actor.name,
                summonerId: actor.ownerId || undefined,
                imagePath: toSerializableImagePath(actor.avatar),
                stats: {
                    hp: actor.hideHp ? 1 : actor.maxHp
                }
            };
            if (actor.side === 'left') players.push(entry);
            else enemies.push(entry);
        });
        participants = { players, enemies };
    } else if (engineState.actors.size > 0) {
        const enrichEntry = (entry) => {
            if (!entry || typeof entry !== 'object') return;
            const id = entry.userId || entry.entityId || entry._id;
            const actor = id ? engineState.actors.get(id) : null;
            if (!actor) return;
            if (!entry.characterName && !entry.name && actor.name) {
                entry.characterName = actor.name;
            }
            if (!entry.imagePath && actor.avatar) {
                entry.imagePath = toSerializableImagePath(actor.avatar);
            }
            if (!entry.stats || typeof entry.stats !== 'object') {
                entry.stats = {};
            }
            if (!actor.hideHp && (!(Number(entry.stats.hp) > 1) || actor.maxHp > Number(entry.stats.hp))) {
                entry.stats.hp = actor.maxHp;
            }
        };
        (participants.players || []).forEach(enrichEntry);
        (participants.enemies || []).forEach(enrichEntry);
    }

    return {
        ...raw,
        result: raw.result || engineState.battleResult || 'WIN',
        participants,
        _mdbvMeta: {
            exportedAt: new Date().toISOString(),
            totalTurns: engineState.totalTurns,
            frameCount: engineState.frames.length
        }
    };
}

/**
 * Exports and triggers a browser file download of the currently loaded battle report as `.json`.
 *
 * @returns {boolean} True if export succeeded, false if no battle report was available.
 */
export function exportCurrentBattleReport() {
    const payload = buildExportableReportPayload();
    if (!payload) {
        alert('目前沒有可匯出的戰報資料！');
        return false;
    }

    let leftRep = 'Player';
    let rightRep = 'Enemy';
    for (const actor of engineState.actors.values()) {
        if (!actor.isSummon && actor.side === 'left' && leftRep === 'Player') {
            leftRep = actor.name;
        } else if (!actor.isSummon && actor.side === 'right' && rightRep === 'Enemy') {
            rightRep = actor.name;
        }
    }

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const filename = `mdbattle-${sanitizeFilenameSegment(leftRep)}-vs-${sanitizeFilenameSegment(rightRep)}-${timestamp}.json`;

    const jsonString = JSON.stringify(payload, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
}

/**
 * Parses and validates a raw JSON string as a battle report payload.
 *
 * @param {string} rawText - Raw JSON file content.
 * @returns {object} Validated battle report payload.
 * @throws {Error} When the JSON is malformed or does not contain battle `logs[]`.
 */
export function parseImportedReportText(rawText) {
    let parsed;
    try {
        parsed = JSON.parse(rawText);
    } catch {
        throw new Error('檔案不是有效的 JSON 格式。');
    }

    const battlePayload = extractBattlePayload(parsed);
    if (!battlePayload) {
        throw new Error('找不到有效的戰鬥紀錄 (缺少 logs 陣列)。');
    }

    return battlePayload;
}

/**
 * Opens a system file picker dialog allowing the user to select a saved `.json` battle report
 * and invokes `onReportLoaded(battlePayload)` upon validation.
 *
 * @param {(battlePayload: object) => void} onReportLoaded - Callback invoked with the parsed battle report.
 */
export function promptImportBattleReport(onReportLoaded) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';

    input.onchange = async () => {
        const file = input.files?.[0];
        input.remove();
        if (!file) return;

        try {
            const text = await file.text();
            const payload = parseImportedReportText(text);
            onReportLoaded(payload);
        } catch (err) {
            alert(`載入戰報失敗：${err.message || '未知錯誤'}`);
        }
    };

    document.body.appendChild(input);
    input.click();
}
