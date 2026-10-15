// ==========================================
// FILE: src/profiles.js
// ==========================================

/**
 * Known Area-of-Effect (AOE) skill identifiers that trigger center-stage casting animations.
 * @type {Set<string>}
 */
export const KNOWN_AOE_SKILLS = new Set([
    'genji_fan_of_blades',
    'inspector_blanket',
    'sylphy_that_day_wind',
    'patriot_dust',
    'patriot_sacrifice',
    'hoarfrost_stomp',
    'guerrilla_mortar_shell',
    'guerrilla_mortar_splash'
]);

/**
 * Prefix mapping used to normalize composite multi-part AOE skills into a single wave group
 * (e.g., main mortar shell + splash damage treated as one unified AOE wave).
 * @type {Record<string, string>}
 */
export const AOE_SKILL_PREFIX_MAP = {
    'guerrilla_mortar_': 'guerrilla_mortar'
};

/**
 * Multi-target combo skills explicitly excluded from center-stage AOE grouping
 * so the caster dashes sequentially to each individual target.
 * @type {Set<string>}
 */
export const AOE_EXCLUDED_SKILLS = new Set([
    'genji_dragonblade',
    'genji_dragonblade_sweep'
]);

/**
 * Battlefield environmental hazard skills that pulse passively without consuming
 * an actor's turn or triggering physical lunge animations.
 * @type {Set<string>}
 */
export const ENVIRONMENTAL_SKILLS = new Set([
    'originium_altar'
]);

/**
 * Detection rules for Boss Phase 2 revival / hidden HP regeneration events.
 * @type {{ dialogueRegex: RegExp, blockKeyword: string }}
 */
export const REBIRTH_RULES = {
    dialogueRegex: /站了起來|進軍|重生|甦醒|恢復|第二階段/,
    blockKeyword: '重生'
};

/**
 * Keyword-to-emoji mapping rules for random LUCK_EVENT falling objects.
 * @type {Array<{ keyword: string, emoji: string }>}
 */
export const LUCK_DROP_EMOJI_RULES = [
    { keyword: '卡車', emoji: '🚚' },
    { keyword: '釘子', emoji: '📌' },
    { keyword: '香蕉皮', emoji: '🍌' },
    { keyword: '樂高', emoji: '🧱' },
    { keyword: '比特犬', emoji: '🐕' },
    { keyword: '飛彈', emoji: '🚀' },
    { keyword: '落雷', emoji: '⚡' },
    { keyword: '棒球', emoji: '⚾' },
    { keyword: '撞到樹', emoji: '🌳' },
    { keyword: '箭', emoji: '🏹' },
    { keyword: '小刀', emoji: '🗡️' },
    { keyword: '隕石', emoji: '☄️' }
];

/**
 * Fallback emoji when a LUCK_EVENT message does not match any specific keyword.
 * @type {string}
 */
export const DEFAULT_LUCK_EMOJI = '💥';

/**
 * Normalizes a raw skill ID into its canonical AOE group identifier.
 * @param {string} [skillId] - The raw skill identifier from the combat log.
 * @returns {string} The normalized skill group identifier.
 */
export function normalizeAOESkillGroup(skillId) {
    if (!skillId) return 'default';
    for (const [prefix, groupName] of Object.entries(AOE_SKILL_PREFIX_MAP)) {
        if (skillId.startsWith(prefix)) return groupName;
    }
    return skillId;
}

/**
 * Resolves the visual drop emoji corresponding to a LUCK_EVENT log message.
 * @param {string} [message=''] - The combat log message.
 * @returns {string} The matched emoji character.
 */
export function getLuckDropEmoji(message = '') {
    for (const rule of LUCK_DROP_EMOJI_RULES) {
        if (message.includes(rule.keyword)) return rule.emoji;
    }
    return DEFAULT_LUCK_EMOJI;
}