// ==========================================
// FILE: src/profiles.js
// ==========================================
/**
 * @fileoverview Declarative skill and character rule profiles.
 * Centralizes AOE skill sets, environmental hazards, boss revival regexes, luck drop emojis,
 * SAO marriage/contract skill lifecycles, Mother's Rosario cross-finisher patterns, and
 * character-specific overhead status badges.
 */

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
export const ULTIMATE_SUBFRAME_REGEX = /^(?:第\s*\d+\s*[劍擊發道]|火翼一收|刀勢未收|綠光連閃|一刀快過一刀|刀勢未盡)|拔出了龍一文字|身上的十字刻下了|還沒完|最後一台車/;

/**
 * Generalized regex matching log messages where a summoned unit voluntarily leaves,
 * dissipates, or is dismissed/returned from the battlefield.
 * Character- and skill-agnostic: matches fading projections, smoke/clone dissipations,
 * party members returning, battle withdrawals, time limits, and dismissals.
 * @type {RegExp}
 */
export const SUMMON_DESPAWN_REGEX = /(?:淡去|散回|散去|消散|消逝|消失|退場|離場|脫離戰場|離開(?:了?戰場)?|離去|撤退|隱沒|揮了揮手，回到|回到.+?(?:隊伍|身邊|身旁|空間|法陣|歸處|冥界|灰霧|陰影|原處|手牌|卡組|召喚)|返回.+?(?:隊伍|身邊|身旁|空間|法陣|冥界|界)|化(?:作|為).*(?:白煙|青煙|黑煙|煙霧|塵埃|光點|虛無|泡影|灰燼)|時間(?:結束|已到|用盡|到了)|解除.*召喚|召喚.*解除|召喚結束)/;

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

/**
 * Checks whether a given rule definition matches a skill identifier.
 * Supports exact string `skillId`, an array of `skillIds`, a RegExp `skillPattern`,
 * or a custom `matchesSkill(skillId)` predicate function.
 *
 * @param {object} rule - Rule or profile containing matching criteria.
 * @param {string} [skillId] - Skill identifier to check.
 * @returns {boolean} True if the rule matches the skillId.
 */
export function matchesSkill(rule, skillId) {
    if (!rule) return false;
    if (rule.skillId === 'default') return true;
    if (rule.skillId && rule.skillId === skillId) return true;
    if (Array.isArray(rule.skillIds) && rule.skillIds.includes(skillId)) return true;
    if (rule.skillPattern instanceof RegExp && rule.skillPattern.test(skillId || '')) return true;
    if (typeof rule.matchesSkill === 'function') return rule.matchesSkill(skillId);
    return false;
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
        skillPattern: /^(kibayuki|yuuki)_trial_marriage$/,
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
        skillPattern: /^(kibayuki|yuuki)_wedding$/,
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
 * Resolves the contract skill configuration for a given skill identifier.
 * Supports exact key lookup or pattern matching across shared marriage skills.
 * @param {string} [skillId] - Skill identifier.
 * @returns {object|null} Matched contract profile or null.
 */
export function getContractSkillProfile(skillId) {
    if (!skillId) return null;
    if (CONTRACT_SKILL_PROFILES[skillId]) return CONTRACT_SKILL_PROFILES[skillId];
    for (const profile of Object.values(CONTRACT_SKILL_PROFILES)) {
        if (matchesSkill(profile, skillId)) return profile;
    }
    if (/trial_marriage|wedding|marriage/i.test(skillId)) {
        return CONTRACT_SKILL_PROFILES.kibayuki_trial_marriage;
    }
    return null;
}

/**
 * Configuration for multi-hit cross-finisher ultimate skills (e.g., Mother's Rosario).
 * @type {Record<string, object>}
 */
export const CROSS_FINISHER_PROFILES = {
    kibayuki_rosario: {
        skillPattern: /^(kibayuki|yuuki)_rosario$/,
        inscribeRegex: /十字刻下了\s*(\d+)\s*道劍痕/,
        pierceRegex: /貫穿十字的正中央/,
        crossColor: '#f687b3',
        glowColor: '#b794f4'
    },
    yuuki_rosario: {
        skillPattern: /^(kibayuki|yuuki)_rosario$/,
        inscribeRegex: /十字刻下了\s*(\d+)\s*道劍痕/,
        pierceRegex: /貫穿十字的正中央/,
        crossColor: '#f687b3',
        glowColor: '#b794f4'
    }
};

/**
 * Resolves the multi-hit cross finisher configuration for a given skill identifier.
 * Supports exact key lookup or fallback to Mother's Rosario patterns.
 * @param {string} [skillId] - Skill identifier.
 * @returns {object|null} Matched cross finisher profile or null.
 */
export function getCrossFinisherProfile(skillId) {
    if (!skillId) return null;
    if (CROSS_FINISHER_PROFILES[skillId]) return CROSS_FINISHER_PROFILES[skillId];
    for (const profile of Object.values(CROSS_FINISHER_PROFILES)) {
        if (matchesSkill(profile, skillId)) return profile;
    }
    if (/rosario/i.test(skillId)) {
        return CROSS_FINISHER_PROFILES.yuuki_rosario || CROSS_FINISHER_PROFILES.kibayuki_rosario;
    }
    return null;
}

/**
 * Special SKILL_TEXT / TEXT status and badge triggers for character-specific flavor skills.
 * @type {Array<{ skillId: string, regex: RegExp, target: 'actor'|'target', text: (match: RegExpMatchArray) => string, styleClass: string, shakeTarget?: boolean }>}
 */
export const SPECIAL_SKILL_BADGE_RULES = [
    // Yuuki / Kibayuki Demand
    {
        skillId: 'kibayuki_demand',
        skillPattern: /^(kibayuki|yuuki)_demand$/,
        regex: /被罵得抬不起頭|出手都心虛了/,
        target: 'target',
        text: () => '💦 心虛',
        styleClass: 'dice-warn',
        shakeTarget: true
    },
    {
        skillId: 'kibayuki_zekken',
        skillPattern: /^(kibayuki|yuuki)_zekken$/,
        regex: /接下這一劍，第\s*(\d+)\s*勝/,
        target: 'actor',
        text: (m) => `⚔️ 絕劍 ${m[1]} 勝!`,
        styleClass: 'dice-pass'
    },
    {
        skillId: 'kibayuki_zekken',
        skillPattern: /^(kibayuki|yuuki)_zekken$/,
        regex: /連勝停在第\s*(\d+)\s*勝/,
        target: 'actor',
        text: (m) => `💔 連勝中斷 (${m[1]}勝)`,
        styleClass: 'dice-fail'
    },
    {
        skillId: 'yuuki_lived',
        skillPattern: /^(kibayuki|yuuki)_lived$/,
        regex: /在倒下前一刻撐住了身體/,
        target: 'actor',
        text: () => '🌸 毅力支撐',
        styleClass: 'dice-pass'
    },
    {
        skillId: 'yuuki_lived',
        skillPattern: /^(kibayuki|yuuki)_lived$/,
        regex: /努力活過了/,
        target: 'actor',
        text: () => '✨ 絕劍的證明',
        styleClass: 'dice-pass'
    },
    {
        skillId: 'kibayuki_legacy',
        skillPattern: /^(kibayuki|yuuki)_legacy$/,
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
    },

    // Patriot & Guerrilla squad skills
    {
        skillId: 'patriot_dust',
        regex: /結晶從他的鎧甲縫隙崩落，化作一陣源石塵暴/,
        target: 'actor',
        text: () => '🌪️ 源石塵暴',
        styleClass: 'dice-warn',
        shakeTarget: true
    },
    {
        skillId: 'patriot_march',
        regex: /頂著塔盾向前壓進/,
        target: 'actor',
        text: () => '🛡️ 盾牆推進',
        styleClass: 'dice-pass'
    },
    {
        skillId: 'patriot_javelin',
        regex: /舉起一支長槍，越過前排/,
        target: 'actor',
        text: () => '🔱 標槍鎖定',
        styleClass: 'dice-warn'
    },
    {
        skillId: 'patriot_sacrifice',
        regex: /身軀燃起源石的紅光|灼熱的脈動/,
        target: 'actor',
        text: () => '🔥 捨身燃燒',
        styleClass: 'dice-warn',
        shakeTarget: true
    },
    {
        skillId: 'patriot_ruin',
        regex: /雙手握戟，一步一步逼向/,
        target: 'actor',
        text: () => '⚡ 雙手毀滅戟',
        styleClass: 'dice-fail'
    },

    // Oripathy & Environmental Debuffs
    {
        skillId: 'oripathy',
        regex: /吸進了源石粉塵|長出了成片的結晶|半邊身體都被結晶覆蓋/,
        target: 'actor',
        text: () => '💎 礦石病侵蝕',
        styleClass: 'dice-warn'
    },

    // Eris & Sylphy
    {
        skillId: 'sylphy_white_hair',
        regex: /硬是撐住了最後一口氣/,
        target: 'actor',
        text: () => '💨 守護風牆',
        styleClass: 'dice-pass'
    },
    {
        skillId: 'eris_deprivation',
        regex: /武器被挑偏，握不穩了/,
        target: 'target',
        text: () => '⚔️ 武器挑偏',
        styleClass: 'dice-fail',
        shakeTarget: true
    },
    {
        skillId: 'eris_silent_sword',
        regex: /露出了破綻/,
        target: 'actor',
        text: () => '⚠️ 架勢破綻',
        styleClass: 'dice-warn'
    }
];

/**
 * Beneficial defensive buff skills that protect an ally and trigger beneficial visual indicators.
 * @type {Set<string>}
 */
export const BENEFICIAL_BUFF_SKILLS = new Set([
    'sakura_shield'
]);

/**
 * Checks whether a skill is a beneficial defensive buff skill (e.g., shields).
 * @param {string} [skillId] - Skill identifier.
 * @returns {boolean} True if the skill is recognized as a beneficial shield/buff.
 */
export function isBeneficialBuffSkill(skillId) {
    if (!skillId) return false;
    if (BENEFICIAL_BUFF_SKILLS.has(skillId)) return true;
    if (/shield|barrier|protect|護盾|防護/i.test(skillId)) return true;
    return false;
}

/**
 * Declarative skill choreography profiles for custom motions, sparks, and target reactions.
 * Decouples character-specific animation branches from the core choreography sequencing engine.
 * @type {Record<string, {
 *   glowColor?: string,
 *   sparkColor?: string,
 *   sparkSize?: number,
 *   targetReaction?: 'RAPID_SHAKE',
 *   shakeDuration?: number
 * }>}
 */
export const SKILL_CHOREOGRAPHY_PROFILES = {
    // Kibayuki & Yuuki demand skills
    kibayuki_demand: {
        targetReaction: 'RAPID_SHAKE',
        shakeDuration: 420
    },
    // Genji cyber-ninja emerald glow & sparks
    genji_swift_strike: {
        glowColor: '#48bb78',
        sparkColor: '#48bb78',
        sparkSize: 55
    },
    genji_dragonblade: {
        glowColor: '#48bb78',
        sparkColor: '#48bb78',
        sparkSize: 55
    },
    genji_dragonblade_sweep: {
        glowColor: '#48bb78',
        sparkColor: '#48bb78',
        sparkSize: 55
    }
};

/**
 * Resolves the declarative choreography profile for a given skill identifier.
 * Supports exact key lookup and pattern matching across shared character skill sets.
 * @param {string} [skillId] - Skill identifier.
 * @returns {object|null} Matched choreography configuration or null.
 */
export function getSkillChoreographyProfile(skillId) {
    if (!skillId) return null;
    if (SKILL_CHOREOGRAPHY_PROFILES[skillId]) {
        return SKILL_CHOREOGRAPHY_PROFILES[skillId];
    }
    if (/^(kibayuki|yuuki)_demand$/.test(skillId)) {
        return SKILL_CHOREOGRAPHY_PROFILES.kibayuki_demand;
    }
    if (/^genji_(swift_strike|dragonblade|dragonblade_sweep)$/.test(skillId)) {
        return SKILL_CHOREOGRAPHY_PROFILES.genji_swift_strike;
    }
    return null;
}