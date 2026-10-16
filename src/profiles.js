// ==========================================
// FILE: src/profiles.js
// ==========================================

/**
 * Known Area-of-Effect (AOE) skill identifiers that trigger center-stage casting animations.
 * @type {Set<string>}
 */
export const KNOWN_AOE_SKILLS = new Set([
    'genji_fan_of_blades',
    'sakura_firey',
    'evaluator_whistle',
    'undead_chef_shovel',
    'undead_chef_curry',
    'oni_gunsou_grenade',
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
 * Ultimate-tier follow-up or passive cleave skills that should not trigger a full-screen Cut-In.
 * @type {Set<string>}
 */
export const ULTIMATE_CUTIN_EXCLUDED_SKILLS = new Set([
    'genji_dragonblade_sweep'
]);

/**
 * Regex matching mid-combo or secondary ultimate log lines that should not re-trigger an Ultimate Cut-In.
 * @type {RegExp}
 */
export const ULTIMATE_SUBFRAME_REGEX = /^(?:第\s*\d+\s*[劍擊發道]|火翼一收|刀勢未收|綠光連閃|一刀快過一刀|刀勢未盡)|拔出了龍一文字/;

/**
 * Regex matching log messages where a summoned unit voluntarily leaves the battlefield.
 * @type {RegExp}
 */
export const SUMMON_DESPAWN_REGEX = /揮了揮手，回到.+?的隊伍裡|離開了戰場|消失在戰場/;

/**
 * Battlefield environmental hazard skills that pulse passively without consuming
 * an actor's turn or triggering physical lunge animations.
 * @type {Set<string>}
 */
export const ENVIRONMENTAL_SKILLS = new Set([
    'originium_altar',
    'undead_chef_karma',
    'oni_gunsou_prayer'
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

// ==========================================
// Special Character & Skill Cinematic Profiles
// ==========================================

/**
 * Configuration for dual/solo system contract skills (e.g., Kibayuki's Trial Marriage & Yuuki's Wedding).
 * Supports both duo pairing (actor + target) and solo fallback.
 * @type {Record<string, object>}
 */
export const CONTRACT_SKILL_PROFILES = {
    kibayuki_trial_marriage: {
        systemTitle: 'SYSTEM ALERT // MARRIAGE REQUEST',
        systemSubtitle: '兩人的道具欄合在了一起',
        badgeIcon: '💍',
        badgeText: '試婚契約',
        endBadgeText: '💔 試婚結束',
        themeColor: '#f687b3',
        proposeRegex: /有人要跟.+?結婚嗎/,
        acceptRegex: /系統跳出了結婚申請|道具欄合在了一起/,
        coverRegex: /擋到.+?身前，替對方扛下了\s*(\d+)\s*點傷害/,
        endRegex: /把婚紗還回了店裡|試婚到此結束/
    },
    yuuki_wedding: {
        systemTitle: 'SYSTEM ALERT // MARRIAGE REQUEST',
        systemSubtitle: '婚禮的鐘聲響起，這一次不是試穿了',
        badgeIcon: '💍',
        badgeText: '七夕婚約',
        endBadgeText: '💔 婚約結束',
        themeColor: '#f687b3',
        proposeRegex: /有人要跟.+?結婚嗎/,
        acceptRegex: /婚禮的鐘聲響起|按下了接受|系統跳出了結婚申請/,
        coverRegex: /擋到.+?身前，替對方扛下了\s*(\d+)\s*點傷害/,
        endRegex: /把婚紗還回了店裡|試婚到此結束/
    }
};

/**
 * Configuration for multi-hit cross-finisher ultimate skills (e.g., Mother's Rosario).
 * @type {Record<string, object>}
 */
export const CROSS_FINISHER_PROFILES = {
    kibayuki_rosario: {
        inscribeRegex: /十字刻下了\s*(\d+)\s*道劍痕/,
        pierceRegex: /貫穿十字的正中央/,
        crossColor: '#f687b3',
        glowColor: '#b794f4'
    },
    yuuki_rosario: {
        inscribeRegex: /十字刻下了\s*(\d+)\s*道劍痕/,
        pierceRegex: /貫穿十字的正中央/,
        crossColor: '#f687b3',
        glowColor: '#b794f4'
    }
};

/**
 * Special SKILL_TEXT / TEXT status and badge triggers for character-specific flavor skills.
 * @type {Array<{ skillId: string, regex: RegExp, target: 'actor'|'target', text: (match: RegExpMatchArray) => string, styleClass: string, shakeTarget?: boolean }>}
 */
export const SPECIAL_SKILL_BADGE_RULES = [
    // Yuuki / Kibayuki
    {
        skillId: 'kibayuki_demand',
        regex: /被罵得抬不起頭|出手都心虛了/,
        target: 'target',
        text: () => '💦 心虛',
        styleClass: 'dice-warn',
        shakeTarget: true
    },
    {
        skillId: 'kibayuki_zekken',
        regex: /接下這一劍，第\s*(\d+)\s*勝/,
        target: 'actor',
        text: (m) => `⚔️ 絕劍 ${m[1]} 勝!`,
        styleClass: 'dice-pass'
    },
    {
        skillId: 'kibayuki_zekken',
        regex: /連勝停在第\s*(\d+)\s*勝/,
        target: 'actor',
        text: (m) => `💔 連勝中斷 (${m[1]}勝)`,
        styleClass: 'dice-fail'
    },
    {
        skillId: 'yuuki_lived',
        regex: /在倒下前一刻撐住了身體/,
        target: 'actor',
        text: () => '🌸 毅力支撐',
        styleClass: 'dice-pass'
    },
    {
        skillId: 'yuuki_lived',
        regex: /努力活過了/,
        target: 'actor',
        text: () => '✨ 絕劍的證明',
        styleClass: 'dice-pass'
    },
    {
        skillId: 'kibayuki_legacy',
        regex: /把聖母聖詠封進卷軸/,
        target: 'target',
        text: () => '📜 託付：聖母聖詠',
        styleClass: 'dice-roll'
    },

    // Kinomoto Sakura
    {
        skillId: 'sakura_release',
        regex: /封印解除/,
        target: 'actor',
        text: () => '🔑 封印解除！',
        styleClass: 'dice-pass'
    },
    {
        skillId: 'sakura_convert',
        regex: /把「(.+?)」轉換成了小櫻牌/,
        target: 'actor',
        text: (m) => `🌟 小櫻牌【${m[1]}】`,
        styleClass: 'dice-roll'
    },
    {
        skillId: 'sakura_shield',
        regex: /透明的光罩張開/,
        target: 'actor',
        text: () => '🛡️ 盾之牌展開',
        styleClass: 'dice-pass'
    },
    {
        skillId: 'sakura_invincible_spell',
        regex: /絕對沒問題的/,
        target: 'actor',
        text: () => '🌸 絕對沒問題的！',
        styleClass: 'dice-pass'
    },

    // Genji
    {
        skillId: 'genji_deflect',
        regex: /擺出了招架的架勢/,
        target: 'actor',
        text: () => '⚔️ 招架架勢',
        styleClass: 'dice-roll'
    },
    {
        skillId: 'default',
        regex: /(?:主要|次要)特殊能力「(.+?)」已啟用/,
        target: 'actor',
        text: (m) => `⚡ ${m[1]}`,
        styleClass: 'dice-pass'
    },
    {
        skillId: 'default',
        regex: /自己繞到邊線抓起一個醫療包/,
        target: 'actor',
        text: () => '🚑 緊急醫療包',
        styleClass: 'dice-pass'
    },
    {
        skillId: 'default',
        regex: /收刀入鞘，綠光熄了/,
        target: 'actor',
        text: () => '🗡️ 收刀入鞘',
        styleClass: 'dice-warn'
    }
];