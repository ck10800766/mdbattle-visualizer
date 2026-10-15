// src/profiles.js

// 1. 已知的 AOE 技能清單
export const KNOWN_AOE_SKILLS = new Set([
  "genji_fan_of_blades",
  "inspector_blanket",
  "sylphy_that_day_wind",
  "patriot_dust",
  "patriot_sacrifice",
  "hoarfrost_stomp",
  "guerrilla_mortar_shell",
  "guerrilla_mortar_splash"
]);

// 2. 複合型 AOE 技能群組歸一化前綴 (如迫擊砲主砲+濺射視為同一波 AOE)
export const AOE_SKILL_PREFIX_MAP = {
  "guerrilla_mortar_": "guerrilla_mortar"
};

// 3. 強制排除在 AOE 波次外的多目標連擊技能 (如源氏拔刀斬需逐一衝刺砍擊)
export const AOE_EXCLUDED_SKILLS = new Set([
  "genji_dragonblade",
  "genji_dragonblade_sweep"
]);

// 4. 場地環境脈衝技能清單 (不計入角色回合、不觸發攻擊位移)
export const ENVIRONMENTAL_SKILLS = new Set([
  "originium_altar"
]);

// 5. Boss 二階段復活 / 甦醒的台詞與格擋關鍵字
export const REBIRTH_RULES = {
  dialogueRegex: /站了起來|進軍|重生|甦醒|恢復|第二階段/,
  blockKeyword: "重生"
};

// 6. LUCK_EVENT 隨機運氣事件掉落物 Emoji 對應表
export const LUCK_DROP_EMOJI_RULES = [
  { keyword: "卡車", emoji: "🚚" },
  { keyword: "釘子", emoji: "📌" },
  { keyword: "香蕉皮", emoji: "🍌" },
  { keyword: "樂高", emoji: "🧱" },
  { keyword: "比特犬", emoji: "🐕" },
  { keyword: "飛彈", emoji: "🚀" },
  { keyword: "落雷", emoji: "⚡" },
  { keyword: "棒球", emoji: "⚾" },
  { keyword: "撞到樹", emoji: "🌳" },
  { keyword: "箭", emoji: "🏹" },
  { keyword: "小刀", emoji: "🗡️" },
  { keyword: "隕石", emoji: "☄️" }
];
export const DEFAULT_LUCK_EMOJI = "💥";

// 輔助函式：歸一化 AOE 技能群組名稱
export function normalizeAOESkillGroup(skillId) {
  if (!skillId) return "default";
  for (const [prefix, groupName] of Object.entries(AOE_SKILL_PREFIX_MAP)) {
    if (skillId.startsWith(prefix)) return groupName;
  }
  return skillId;
}

// 輔助函式：取得運氣事件對應的 Emoji[cite: 1]
export function getLuckDropEmoji(message = "") {
  for (const rule of LUCK_DROP_EMOJI_RULES) {
    if (message.includes(rule.keyword)) return rule.emoji;
  }
  return DEFAULT_LUCK_EMOJI;
}