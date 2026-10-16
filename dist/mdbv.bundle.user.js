// ==UserScript==
// @name         MDBattle-Visualizer (Ultimate Edition V7.5)
// @namespace    mydoujin-battle-vfx
// @version      7.5.0
// @description  True ATB Timeline, live battle interception, anti-spoiler guard, and refined combat mechanics.
// @match        https://mydoujin.online/*
// @run-at       document-start
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ck10800766/mdbattle-visualizer/main/dist/mdbv.bundle.user.js
// @downloadURL  https://raw.githubusercontent.com/ck10800766/mdbattle-visualizer/main/dist/mdbv.bundle.user.js
// ==/UserScript==

(() => {
  // src/constants.js
  var API_BASE = "https://mydoujin-backend.onrender.com";
  var ASSET_HOST = "https://mydoujin.online";
  var DEFAULT_AVATAR_URL = "https://via.placeholder.com/150";
  var DEFAULT_MVP_AVATAR_URL = "https://via.placeholder.com/600";
  var HOST_CONTENT_SELECTOR = ".css-1svsvwq";
  var PLAYBACK_SPEEDS = Object.freeze([0.5, 1, 2, 4]);
  var SPEED_STORAGE_KEY = "mdbv_playback_speed";

  // src/state.js
  function loadSavedPlaybackSpeed() {
    try {
      if (typeof localStorage !== "undefined") {
        const raw = Number(localStorage.getItem(SPEED_STORAGE_KEY));
        if (PLAYBACK_SPEEDS.includes(raw)) {
          return raw;
        }
      }
    } catch {
    }
    return 1;
  }
  function createEmptyCombo() {
    return {
      actorId: null,
      skillId: null,
      targetId: null,
      count: 0,
      totalDamage: 0,
      targetDamages: {},
      targetHitCounts: {},
      knockedBack: false,
      keepAlive: false,
      targetChangedThisHit: false,
      heldForCoverActorId: null,
      moveX: void 0,
      deltaY: void 0,
      prevMoveX: 0,
      prevDeltaY: 0,
      aoeCenterX: void 0,
      aoeCenterY: void 0,
      atCenterStage: false,
      lastFrameIndex: -1
    };
  }
  var engineState = {
    lastReportData: null,
    frames: [],
    currentFrameIndex: 0,
    isPlaying: false,
    playbackSpeed: loadSavedPlaybackSpeed(),
    timeScale: 1,
    playbackToken: 0,
    currentCombo: createEmptyCombo(),
    floatTracker: /* @__PURE__ */ new Map(),
    shadowRoot: null,
    hostElement: null,
    actors: /* @__PURE__ */ new Map(),
    totalTurns: 0,
    battleResult: "WIN",
    onImportReport: null,
    activeKeydownHandler: null
  };
  function setPlaybackSpeed(speed) {
    const validSpeed = PLAYBACK_SPEEDS.includes(speed) ? speed : 1;
    engineState.playbackSpeed = validSpeed;
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(SPEED_STORAGE_KEY, String(validSpeed));
      }
    } catch {
    }
    return validSpeed;
  }
  function getEffectiveSpeed() {
    return Math.max(0.05, engineState.playbackSpeed * engineState.timeScale);
  }
  function nextPlaybackToken() {
    engineState.playbackToken += 1;
    return engineState.playbackToken;
  }

  // src/participants.js
  function createActorEntity({
    id,
    name = "Unknown",
    side = "left",
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
  function inferSummonName(logs, summonIndex, summonId, ownerName) {
    const summonLog = logs[summonIndex];
    if (!summonLog) return "Summon";
    const explicitName = summonLog.targetName || summonLog.summonName || summonLog.characterName || summonLog.name;
    if (explicitName) return String(explicitName).trim();
    for (let i = summonIndex + 1; i < logs.length; i++) {
      const log = logs[i];
      if (!log || typeof log !== "object") continue;
      const msg = String(log.message || "");
      if (log.actorId === summonId) {
        if (["DEATH", "PLAYER_DEATH", "PLAYER_DEFEAT"].includes(log.type)) {
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
      if (log.targetId === summonId && ["DAMAGE", "BLOCK", "HEAL"].includes(log.type)) {
        const targetMatch = msg.match(/對\s+(\S+?)\s+造成/);
        if (targetMatch) return targetMatch[1];
      }
    }
    const summonMsg = String(summonLog.message || "").trim();
    const whitespaceTokens = summonMsg.split(/\s+/);
    if (whitespaceTokens.length >= 3) {
      const candidate = whitespaceTokens[whitespaceTokens.length - 2].split(/[，,。！!、的]/).pop();
      if (candidate && candidate !== ownerName) {
        return candidate;
      }
    }
    return "Summon";
  }
  function parseParticipants(reportData) {
    engineState.actors.clear();
    const p = reportData.participants || {};
    const logs = reportData.logs || [];
    const fallbackBossImage = reportData.boss ? reportData.boss.imagePath : null;
    const summonedIds = /* @__PURE__ */ new Set();
    logs.forEach((log) => {
      if (log && log.type === "SUMMON" && log.targetId) {
        summonedIds.add(log.targetId);
      }
    });
    const resolveAvatarUrl = (avatarPath) => {
      if (!avatarPath) return DEFAULT_AVATAR_URL;
      if (/^https?:\/\//i.test(avatarPath)) return avatarPath;
      return `${ASSET_HOST}${avatarPath}`;
    };
    (p.players || []).forEach((player) => {
      const id = player.userId || player.entityId || player._id;
      const name = player.characterName || player.name || "Unknown";
      const rawHp = Number(player.stats?.hp);
      const isSummon = !!player.summonerId || summonedIds.has(id);
      const hideHp = isSummon && !(rawHp > 1);
      const maxHp = rawHp > 0 ? rawHp : 1;
      const avatarPath = player.imagePath;
      engineState.actors.set(id, createActorEntity({
        id,
        name,
        side: "left",
        maxHp,
        hideHp,
        avatar: resolveAvatarUrl(avatarPath),
        isSummon,
        ownerId: player.summonerId || null,
        initiallySpawned: !isSummon
      }));
    });
    (p.enemies || []).forEach((enemy) => {
      const id = enemy.userId || enemy.entityId || enemy._id;
      const name = enemy.characterName || enemy.name || "Unknown";
      const rawHp = Number(enemy.stats?.hp);
      const isSummon = !!enemy.summonerId || summonedIds.has(id);
      const hideHp = isSummon && !(rawHp > 1);
      const maxHp = rawHp > 0 ? rawHp : 1;
      let avatarPath = enemy.imagePath;
      if ((!avatarPath || avatarPath.includes("default-boss.webp")) && fallbackBossImage) {
        avatarPath = fallbackBossImage;
      }
      engineState.actors.set(id, createActorEntity({
        id,
        name,
        side: "right",
        maxHp,
        hideHp,
        avatar: resolveAvatarUrl(avatarPath),
        isSummon,
        ownerId: enemy.summonerId || null,
        initiallySpawned: !isSummon
      }));
    });
    logs.forEach((log, index) => {
      if (!log || log.type !== "SUMMON" || !log.targetId) return;
      const owner = engineState.actors.get(log.actorId);
      const summonName = inferSummonName(logs, index, log.targetId, owner?.name || "");
      if (!engineState.actors.has(log.targetId)) {
        engineState.actors.set(log.targetId, createActorEntity({
          id: log.targetId,
          name: summonName,
          side: owner ? owner.side : "left",
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
  function getConsolidatedStats() {
    let mvp = null;
    let maxTotalDamage = 0;
    const consolidated = /* @__PURE__ */ new Map();
    engineState.actors.forEach((actor) => {
      if (actor.side === "left") {
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
    consolidated.forEach((stats) => {
      if (!stats.actor.isSummon && stats.totalOutput > maxTotalDamage) {
        maxTotalDamage = stats.totalOutput;
        mvp = stats.actor;
      }
    });
    return { consolidated, mvp, maxTotalDamage };
  }

  // src/profiles.js
  var KNOWN_AOE_SKILLS = /* @__PURE__ */ new Set([
    "genji_fan_of_blades",
    "sakura_firey",
    "evaluator_whistle",
    "undead_chef_shovel",
    "undead_chef_curry",
    "oni_gunsou_grenade",
    "inspector_blanket",
    "sylphy_that_day_wind",
    "patriot_dust",
    "patriot_sacrifice",
    "hoarfrost_stomp",
    "guerrilla_mortar_shell",
    "guerrilla_mortar_splash"
  ]);
  var AOE_SKILL_PREFIX_MAP = {
    "guerrilla_mortar_": "guerrilla_mortar"
  };
  var AOE_EXCLUDED_SKILLS = /* @__PURE__ */ new Set([
    "genji_dragonblade",
    "genji_dragonblade_sweep"
  ]);
  var ULTIMATE_CUTIN_EXCLUDED_SKILLS = /* @__PURE__ */ new Set([
    "genji_dragonblade_sweep"
  ]);
  var ULTIMATE_SUBFRAME_REGEX = /^(?:第\s*\d+\s*[劍擊發道]|火翼一收|刀勢未收|綠光連閃|一刀快過一刀|刀勢未盡)|拔出了龍一文字/;
  var SUMMON_DESPAWN_REGEX = /揮了揮手，回到.+?的隊伍裡|離開了戰場|消失在戰場/;
  var ENVIRONMENTAL_SKILLS = /* @__PURE__ */ new Set([
    "originium_altar",
    "undead_chef_karma",
    "oni_gunsou_prayer"
  ]);
  var REBIRTH_RULES = {
    dialogueRegex: /站了起來|進軍|重生|甦醒|恢復|第二階段/,
    blockKeyword: "\u91CD\u751F"
  };
  var LUCK_DROP_EMOJI_RULES = [
    { keyword: "\u5361\u8ECA", emoji: "\u{1F69A}" },
    { keyword: "\u91D8\u5B50", emoji: "\u{1F4CC}" },
    { keyword: "\u9999\u8549\u76AE", emoji: "\u{1F34C}" },
    { keyword: "\u6A02\u9AD8", emoji: "\u{1F9F1}" },
    { keyword: "\u6BD4\u7279\u72AC", emoji: "\u{1F415}" },
    { keyword: "\u98DB\u5F48", emoji: "\u{1F680}" },
    { keyword: "\u843D\u96F7", emoji: "\u26A1" },
    { keyword: "\u68D2\u7403", emoji: "\u26BE" },
    { keyword: "\u649E\u5230\u6A39", emoji: "\u{1F333}" },
    { keyword: "\u7BAD", emoji: "\u{1F3F9}" },
    { keyword: "\u5C0F\u5200", emoji: "\u{1F5E1}\uFE0F" },
    { keyword: "\u9695\u77F3", emoji: "\u2604\uFE0F" }
  ];
  var DEFAULT_LUCK_EMOJI = "\u{1F4A5}";
  function normalizeAOESkillGroup(skillId) {
    if (!skillId) return "default";
    for (const [prefix, groupName] of Object.entries(AOE_SKILL_PREFIX_MAP)) {
      if (skillId.startsWith(prefix)) return groupName;
    }
    return skillId;
  }
  function getLuckDropEmoji(message = "") {
    for (const rule of LUCK_DROP_EMOJI_RULES) {
      if (message.includes(rule.keyword)) return rule.emoji;
    }
    return DEFAULT_LUCK_EMOJI;
  }
  function matchesSkill(rule, skillId) {
    if (!rule) return false;
    if (rule.skillId === "default") return true;
    if (rule.skillId && rule.skillId === skillId) return true;
    if (Array.isArray(rule.skillIds) && rule.skillIds.includes(skillId)) return true;
    if (rule.skillPattern instanceof RegExp && rule.skillPattern.test(skillId || "")) return true;
    if (typeof rule.matchesSkill === "function") return rule.matchesSkill(skillId);
    return false;
  }
  var CONTRACT_SKILL_PROFILES = {
    kibayuki_trial_marriage: {
      skillPattern: /^(kibayuki|yuuki)_trial_marriage$/,
      systemTitle: "SYSTEM ALERT // MARRIAGE REQUEST",
      systemSubtitle: "\u5169\u4EBA\u7684\u9053\u5177\u6B04\u5408\u5728\u4E86\u4E00\u8D77",
      badgeIcon: "\u{1F48D}",
      badgeText: "\u8A66\u5A5A\u5951\u7D04",
      endBadgeText: "\u{1F494} \u8A66\u5A5A\u7D50\u675F",
      themeColor: "#f687b3",
      proposeRegex: /有人要跟.+?結婚嗎/,
      acceptRegex: /系統跳出了結婚申請|道具欄合在了一起/,
      coverRegex: /擋到.+?身前，替對方扛下了\s*(\d+)\s*點傷害/,
      endRegex: /把婚紗還回了店裡|試婚到此結束/
    },
    yuuki_wedding: {
      skillPattern: /^(kibayuki|yuuki)_wedding$/,
      systemTitle: "SYSTEM ALERT // MARRIAGE REQUEST",
      systemSubtitle: "\u5A5A\u79AE\u7684\u9418\u8072\u97FF\u8D77\uFF0C\u9019\u4E00\u6B21\u4E0D\u662F\u8A66\u7A7F\u4E86",
      badgeIcon: "\u{1F48D}",
      badgeText: "\u4E03\u5915\u5A5A\u7D04",
      endBadgeText: "\u{1F494} \u5A5A\u7D04\u7D50\u675F",
      themeColor: "#f687b3",
      proposeRegex: /有人要跟.+?結婚嗎/,
      acceptRegex: /婚禮的鐘聲響起|按下了接受|系統跳出了結婚申請/,
      coverRegex: /擋到.+?身前，替對方扛下了\s*(\d+)\s*點傷害/,
      endRegex: /把婚紗還回了店裡|試婚到此結束/
    }
  };
  function getContractSkillProfile(skillId) {
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
  var CROSS_FINISHER_PROFILES = {
    kibayuki_rosario: {
      skillPattern: /^(kibayuki|yuuki)_rosario$/,
      inscribeRegex: /十字刻下了\s*(\d+)\s*道劍痕/,
      pierceRegex: /貫穿十字的正中央/,
      crossColor: "#f687b3",
      glowColor: "#b794f4"
    },
    yuuki_rosario: {
      skillPattern: /^(kibayuki|yuuki)_rosario$/,
      inscribeRegex: /十字刻下了\s*(\d+)\s*道劍痕/,
      pierceRegex: /貫穿十字的正中央/,
      crossColor: "#f687b3",
      glowColor: "#b794f4"
    }
  };
  function getCrossFinisherProfile(skillId) {
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
  var SPECIAL_SKILL_BADGE_RULES = [
    // Yuuki / Kibayuki Demand
    {
      skillId: "kibayuki_demand",
      skillPattern: /^(kibayuki|yuuki)_demand$/,
      regex: /被罵得抬不起頭|出手都心虛了/,
      target: "target",
      text: () => "\u{1F4A6} \u5FC3\u865B",
      styleClass: "dice-warn",
      shakeTarget: true
    },
    {
      skillId: "kibayuki_zekken",
      skillPattern: /^(kibayuki|yuuki)_zekken$/,
      regex: /接下這一劍，第\s*(\d+)\s*勝/,
      target: "actor",
      text: (m) => `\u2694\uFE0F \u7D55\u528D ${m[1]} \u52DD!`,
      styleClass: "dice-pass"
    },
    {
      skillId: "kibayuki_zekken",
      skillPattern: /^(kibayuki|yuuki)_zekken$/,
      regex: /連勝停在第\s*(\d+)\s*勝/,
      target: "actor",
      text: (m) => `\u{1F494} \u9023\u52DD\u4E2D\u65B7 (${m[1]}\u52DD)`,
      styleClass: "dice-fail"
    },
    {
      skillId: "yuuki_lived",
      skillPattern: /^(kibayuki|yuuki)_lived$/,
      regex: /在倒下前一刻撐住了身體/,
      target: "actor",
      text: () => "\u{1F338} \u6BC5\u529B\u652F\u6490",
      styleClass: "dice-pass"
    },
    {
      skillId: "yuuki_lived",
      skillPattern: /^(kibayuki|yuuki)_lived$/,
      regex: /努力活過了/,
      target: "actor",
      text: () => "\u2728 \u7D55\u528D\u7684\u8B49\u660E",
      styleClass: "dice-pass"
    },
    {
      skillId: "kibayuki_legacy",
      skillPattern: /^(kibayuki|yuuki)_legacy$/,
      regex: /把聖母聖詠封進卷軸/,
      target: "target",
      text: () => "\u{1F4DC} \u8A17\u4ED8\uFF1A\u8056\u6BCD\u8056\u8A60",
      styleClass: "dice-roll"
    },
    // Kinomoto Sakura
    {
      skillId: "sakura_release",
      regex: /封印解除/,
      target: "actor",
      text: () => "\u{1F511} \u5C01\u5370\u89E3\u9664\uFF01",
      styleClass: "dice-pass"
    },
    {
      skillId: "sakura_convert",
      regex: /把「(.+?)」轉換成了小櫻牌/,
      target: "actor",
      text: (m) => `\u{1F31F} \u5C0F\u6AFB\u724C\u3010${m[1]}\u3011`,
      styleClass: "dice-roll"
    },
    {
      skillId: "sakura_shield",
      regex: /透明的光罩張開/,
      target: "actor",
      text: () => "\u{1F6E1}\uFE0F \u76FE\u4E4B\u724C\u5C55\u958B",
      styleClass: "dice-pass"
    },
    {
      skillId: "sakura_invincible_spell",
      regex: /絕對沒問題的/,
      target: "actor",
      text: () => "\u{1F338} \u7D55\u5C0D\u6C92\u554F\u984C\u7684\uFF01",
      styleClass: "dice-pass"
    },
    // Genji
    {
      skillId: "genji_deflect",
      regex: /擺出了招架的架勢/,
      target: "actor",
      text: () => "\u2694\uFE0F \u62DB\u67B6\u67B6\u52E2",
      styleClass: "dice-roll"
    },
    {
      skillId: "default",
      regex: /(?:主要|次要)特殊能力「(.+?)」已啟用/,
      target: "actor",
      text: (m) => `\u26A1 ${m[1]}`,
      styleClass: "dice-pass"
    },
    {
      skillId: "default",
      regex: /自己繞到邊線抓起一個醫療包/,
      target: "actor",
      text: () => "\u{1F691} \u7DCA\u6025\u91AB\u7642\u5305",
      styleClass: "dice-pass"
    },
    {
      skillId: "default",
      regex: /收刀入鞘，綠光熄了/,
      target: "actor",
      text: () => "\u{1F5E1}\uFE0F \u6536\u5200\u5165\u9798",
      styleClass: "dice-warn"
    },
    // Patriot & Guerrilla squad skills
    {
      skillId: "patriot_dust",
      regex: /結晶從他的鎧甲縫隙崩落，化作一陣源石塵暴/,
      target: "actor",
      text: () => "\u{1F32A}\uFE0F \u6E90\u77F3\u5875\u66B4",
      styleClass: "dice-warn",
      shakeTarget: true
    },
    {
      skillId: "patriot_march",
      regex: /頂著塔盾向前壓進/,
      target: "actor",
      text: () => "\u{1F6E1}\uFE0F \u76FE\u7246\u63A8\u9032",
      styleClass: "dice-pass"
    },
    {
      skillId: "patriot_javelin",
      regex: /舉起一支長槍，越過前排/,
      target: "actor",
      text: () => "\u{1F531} \u6A19\u69CD\u9396\u5B9A",
      styleClass: "dice-warn"
    },
    {
      skillId: "patriot_sacrifice",
      regex: /身軀燃起源石的紅光|灼熱的脈動/,
      target: "actor",
      text: () => "\u{1F525} \u6368\u8EAB\u71C3\u71D2",
      styleClass: "dice-warn",
      shakeTarget: true
    },
    {
      skillId: "patriot_ruin",
      regex: /雙手握戟，一步一步逼向/,
      target: "actor",
      text: () => "\u26A1 \u96D9\u624B\u6BC0\u6EC5\u621F",
      styleClass: "dice-fail"
    },
    // Oripathy & Environmental Debuffs
    {
      skillId: "oripathy",
      regex: /吸進了源石粉塵|長出了成片的結晶|半邊身體都被結晶覆蓋/,
      target: "actor",
      text: () => "\u{1F48E} \u7926\u77F3\u75C5\u4FB5\u8755",
      styleClass: "dice-warn"
    },
    // Eris & Sylphy
    {
      skillId: "sylphy_white_hair",
      regex: /硬是撐住了最後一口氣/,
      target: "actor",
      text: () => "\u{1F4A8} \u5B88\u8B77\u98A8\u7246",
      styleClass: "dice-pass"
    },
    {
      skillId: "eris_deprivation",
      regex: /武器被挑偏，握不穩了/,
      target: "target",
      text: () => "\u2694\uFE0F \u6B66\u5668\u6311\u504F",
      styleClass: "dice-fail",
      shakeTarget: true
    },
    {
      skillId: "eris_silent_sword",
      regex: /露出了破綻/,
      target: "actor",
      text: () => "\u26A0\uFE0F \u67B6\u52E2\u7834\u7DBB",
      styleClass: "dice-warn"
    }
  ];
  var BENEFICIAL_BUFF_SKILLS = /* @__PURE__ */ new Set([
    "sakura_shield"
  ]);
  function isBeneficialBuffSkill(skillId) {
    if (!skillId) return false;
    if (BENEFICIAL_BUFF_SKILLS.has(skillId)) return true;
    if (/shield|barrier|protect|護盾|防護/i.test(skillId)) return true;
    return false;
  }
  var SKILL_CHOREOGRAPHY_PROFILES = {
    // Kibayuki & Yuuki demand skills
    kibayuki_demand: {
      targetReaction: "RAPID_SHAKE",
      shakeDuration: 420
    },
    // Genji cyber-ninja emerald glow & sparks
    genji_swift_strike: {
      glowColor: "#48bb78",
      sparkColor: "#48bb78",
      sparkSize: 55
    },
    genji_dragonblade: {
      glowColor: "#48bb78",
      sparkColor: "#48bb78",
      sparkSize: 55
    },
    genji_dragonblade_sweep: {
      glowColor: "#48bb78",
      sparkColor: "#48bb78",
      sparkSize: 55
    }
  };
  function getSkillChoreographyProfile(skillId) {
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

  // src/calibrator.js
  function markAOEWaves(frames) {
    let i = 0;
    while (i < frames.length) {
      const f = frames[i];
      if (!["DAMAGE", "MISS", "BLOCK", "COUNTER"].includes(f.type) || f.isSelfDamage || f.isEnvironmentalPulse) {
        i++;
        continue;
      }
      const isCounterFrame = f.type === "COUNTER" || f.isCounter;
      const casterId = isCounterFrame ? f.targetId : f.actorId;
      const rawSkillId = isCounterFrame ? f.incomingSkillId : f.skillId;
      if (!casterId || !rawSkillId || AOE_EXCLUDED_SKILLS.has(rawSkillId)) {
        i++;
        continue;
      }
      const baseSkill = normalizeAOESkillGroup(rawSkillId);
      const waveAnimatedFrames = [];
      const distinctTargets = /* @__PURE__ */ new Set();
      let j = i;
      let lastWaveFrameIndex = i;
      while (j < frames.length) {
        const cur = frames[j];
        if (cur.isSelfDamage || cur.isEnvironmentalPulse) break;
        if (["DAMAGE", "MISS", "BLOCK"].includes(cur.type) && !cur.isCounter) {
          if (cur.actorId === casterId && normalizeAOESkillGroup(cur.skillId) === baseSkill) {
            waveAnimatedFrames.push(cur);
            if (cur.targetId) distinctTargets.add(cur.targetId);
            lastWaveFrameIndex = j;
            j++;
            continue;
          }
          break;
        }
        if (cur.type === "COUNTER" || cur.isCounter) {
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
        if (["HEAL", "LUCK_EVENT", "SUMMON"].includes(cur.type)) {
          break;
        }
        if (cur.type === "SKILL_TEXT" && cur.actorId !== casterId) {
          break;
        }
        if (cur.type === "SKILL_TEXT" && cur.actorId === casterId && cur.skillId && normalizeAOESkillGroup(cur.skillId) !== baseSkill) {
          break;
        }
        j++;
      }
      const isKnownAOE = KNOWN_AOE_SKILLS.has(rawSkillId) || KNOWN_AOE_SKILLS.has(baseSkill);
      const isMultiTargetWave = distinctTargets.size >= 2 && waveAnimatedFrames.length <= distinctTargets.size * 2;
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
  function calibrateHpWithAnchors(frames) {
    engineState.actors.forEach((actor) => {
      if (actor.hideHp) return;
      let anchorIndex = -1;
      let anchorHp = null;
      for (let i = frames.length - 1; i >= 0; i--) {
        const f = frames[i];
        if (f.type === "HP_REMAINING" && f.actorId === actor.id) {
          anchorIndex = i;
          anchorHp = f.value;
          break;
        }
        if (["DEATH", "PLAYER_DEATH", "PLAYER_DEFEAT"].includes(f.type) && f.actorId === actor.id) {
          anchorIndex = i;
          anchorHp = 0;
          break;
        }
      }
      if (anchorIndex < 0 || anchorHp == null) return;
      let lowHpStartIndex = -1;
      for (let i = 0; i <= anchorIndex; i++) {
        const hp = frames[i].actorsHpState.get(actor.id);
        if (hp != null && hp <= 1) {
          lowHpStartIndex = i;
          break;
        }
      }
      if (lowHpStartIndex < 0) {
        for (let i = anchorIndex; i < frames.length; i++) {
          frames[i].actorsHpState.set(actor.id, anchorHp);
        }
        return;
      }
      const hpAtLowStart = frames[lowHpStartIndex].actorsHpState.get(actor.id) ?? 0;
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
      if (Math.abs(missingHeal) <= 1) {
        for (let i = anchorIndex; i < frames.length; i++) {
          frames[i].actorsHpState.set(actor.id, anchorHp);
        }
        return;
      }
      const rebirthIndices = [];
      let lastDamageFrameSeen = lowHpStartIndex;
      for (let i = lowHpStartIndex + 1; i <= anchorIndex; i++) {
        const f = frames[i];
        const delta = f.hpDeltas?.get(actor.id) || 0;
        if (delta < 0) {
          lastDamageFrameSeen = i;
        }
        if (f.actorId === actor.id && ["TEXT", "BOSS_DIALOGUE", "SKILL_TEXT"].includes(f.type) && REBIRTH_RULES.dialogueRegex.test(f.message)) {
          if (rebirthIndices.length === 0 || lastDamageFrameSeen > rebirthIndices[rebirthIndices.length - 1]) {
            rebirthIndices.push(i);
          } else {
            rebirthIndices[rebirthIndices.length - 1] = i;
          }
        }
      }
      if (rebirthIndices.length === 0) {
        const searchLimit = firstPostRebirthDeltaIndex !== -1 ? firstPostRebirthDeltaIndex : anchorIndex;
        let fallbackIdx = -1;
        for (let i = lowHpStartIndex + 1; i <= searchLimit; i++) {
          const f = frames[i];
          if (f.targetId === actor.id && f.type === "BLOCK" && f.message.includes(REBIRTH_RULES.blockKeyword)) {
            fallbackIdx = i;
            break;
          }
        }
        rebirthIndices.push(fallbackIdx !== -1 ? fallbackIdx : searchLimit);
      }
      for (let s = 0; s < rebirthIndices.length; s++) {
        const rIdx = rebirthIndices[s];
        const segEnd = s + 1 < rebirthIndices.length ? rebirthIndices[s + 1] - 1 : anchorIndex;
        const segEndHp = s + 1 < rebirthIndices.length ? 0 : anchorHp;
        const backwardHp = new Array(segEnd - rIdx + 1);
        let currentBackHp = segEndHp;
        for (let i = segEnd; i >= rIdx; i--) {
          backwardHp[i - rIdx] = currentBackHp;
          const delta = frames[i].hpDeltas?.get(actor.id) || 0;
          currentBackHp = Math.max(0, Math.min(actor.maxHp, currentBackHp - delta));
        }
        const prevHp = frames[Math.max(0, rIdx - 1)].actorsHpState.get(actor.id) ?? 0;
        const healedAmount = Math.round(backwardHp[0] - prevHp);
        if (healedAmount > 0) {
          const rebirthFrame = frames[rIdx];
          rebirthFrame.rebirthHeal = true;
          if (["TEXT", "BOSS_DIALOGUE", "SKILL_TEXT"].includes(rebirthFrame.type) || !rebirthFrame.value) {
            rebirthFrame.isBeneficial = true;
            rebirthFrame.value = healedAmount;
          }
          if (!rebirthFrame.vfx.includes("flash-green")) {
            rebirthFrame.vfx.push("flash-green");
          }
        }
        for (let i = rIdx; i <= segEnd; i++) {
          frames[i].actorsHpState.set(actor.id, backwardHp[i - rIdx]);
        }
      }
      for (let i = anchorIndex + 1; i < frames.length; i++) {
        frames[i].actorsHpState.set(actor.id, anchorHp);
      }
    });
  }

  // src/parser.js
  function detectCounterSetup(logs, index, log, rawValue) {
    if (log.type !== "COUNTER") return false;
    for (let j = index + 1; j < Math.min(logs.length, index + 6); j++) {
      const nextLog = logs[j];
      if (nextLog && (nextLog.type === "DAMAGE" || nextLog.type === "BLOCK") && nextLog.isCounter && (Number(nextLog.value) === rawValue || nextLog.actorId === log.actorId)) {
        return true;
      }
    }
    return false;
  }
  function evaluateTurnOwnership(frame, isReactiveCoverText) {
    let isTurnAction = false;
    let turnActorId = frame.actorId;
    if (frame.type === "BOSS_DIALOGUE") {
      isTurnAction = true;
    } else if (frame.type === "SKILL_TEXT" && !frame.isCounter && !frame.passiveId && !isReactiveCoverText) {
      isTurnAction = true;
    } else if (["DAMAGE", "MISS", "BLOCK"].includes(frame.type) && !frame.isCounter && !frame.isSelfDamage && !frame.isEnvironmentalPulse && frame.source !== "DIRECT" && frame.source !== "REFLECTION") {
      isTurnAction = true;
    } else if (frame.type === "COUNTER" && frame.targetId) {
      isTurnAction = true;
      turnActorId = frame.targetId;
    }
    return { isTurnAction, turnActorId };
  }
  function processSummonLifecycle(log, index, logs, frame, actorsDeathState, actorsSummonState, explicitlySummonedIds, despawnedActors) {
    if (log.type === "SUMMON" && log.targetId) {
      const owner = engineState.actors.get(log.actorId);
      const summonName = inferSummonName(logs, index, log.targetId, owner?.name || "");
      if (!engineState.actors.has(log.targetId)) {
        engineState.actors.set(log.targetId, createActorEntity({
          id: log.targetId,
          name: summonName,
          side: owner ? owner.side : "left",
          maxHp: 1,
          hideHp: true,
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
      despawnedActors.delete(log.targetId);
      actorsSummonState.set(log.targetId, true);
      frame.isSummonEvent = true;
      frame.summonedActorId = log.targetId;
    }
    if (log.actorId && actorsSummonState.get(log.actorId) === false && !explicitlySummonedIds.has(log.actorId) && !despawnedActors.has(log.actorId) && !SUMMON_DESPAWN_REGEX.test(frame.message) && !["DEATH", "PLAYER_DEATH", "PLAYER_DEFEAT", "HP_REMAINING", "EXP_GAIN"].includes(log.type)) {
      const summonActor = engineState.actors.get(log.actorId);
      if (summonActor && summonActor.isSummon) {
        summonActor.currentHp = summonActor.maxHp;
        actorsDeathState.set(log.actorId, false);
        actorsSummonState.set(log.actorId, true);
        frame.isSummonEvent = true;
        frame.summonedActorId = log.actorId;
      }
    }
    if (log.actorId && (log.type === "SKILL_TEXT" || log.type === "TEXT") && SUMMON_DESPAWN_REGEX.test(frame.message)) {
      const actingUnit = engineState.actors.get(log.actorId);
      if (actingUnit && actingUnit.isSummon && actorsSummonState.get(log.actorId) !== false) {
        actorsSummonState.set(log.actorId, false);
        despawnedActors.add(log.actorId);
        frame.isDespawnEvent = true;
        frame.despawnedActorId = log.actorId;
      }
    }
  }
  function processContractSkillLifecycle(frame, contractProfile, msg, target, actorsBondState, contractCutInCount, addHpDelta) {
    if (contractProfile.proposeRegex.test(msg)) {
      frame.contractEvent = "PROPOSE";
    } else if (contractProfile.acceptRegex.test(msg)) {
      frame.contractEvent = "ACCEPT";
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
      frame.contractEvent = "COVER";
      frame.isCoverEvent = true;
      frame.coverDamage = coverAmount;
      let coverAttackerId = null;
      for (let k = engineState.frames.length - 1; k >= Math.max(0, engineState.frames.length - 5); k--) {
        const prev = engineState.frames[k];
        if (prev && ["DAMAGE", "BLOCK", "MISS", "COUNTER"].includes(prev.type) && prev.actorId && prev.actorId !== frame.actorId && prev.actorId !== frame.targetId) {
          coverAttackerId = prev.actorId;
          if (prev.targetId === frame.targetId) {
            prev.holdPositionForCover = true;
          }
          break;
        }
      }
      if (!coverAttackerId) {
        const protectorSide = target?.side || "left";
        engineState.actors.forEach((a) => {
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
      frame.contractEvent = "END";
      actorsBondState.forEach((bond, bondedActorId) => {
        if (bondedActorId === frame.actorId || bond.partnerId === frame.actorId) {
          actorsBondState.delete(bondedActorId);
        }
      });
    }
  }
  function buildStateSnapshots(logs) {
    engineState.frames = [];
    let currentTurn = 0;
    let lastTurnActorId = null;
    const buffSrc = {};
    const applyLog = [];
    const prefixOwner = {};
    const IGNORE_PREFIX = { basic: 1, imitated: 1, standard: 1 };
    const actorsDeathState = /* @__PURE__ */ new Map();
    const actorsSummonState = /* @__PURE__ */ new Map();
    const actorsBondState = /* @__PURE__ */ new Map();
    const contractCutInCount = /* @__PURE__ */ new Map();
    const despawnedActors = /* @__PURE__ */ new Set();
    const explicitlySummonedIds = /* @__PURE__ */ new Set();
    logs.forEach((log) => {
      if (log && log.type === "SUMMON" && log.targetId) {
        explicitlySummonedIds.add(log.targetId);
      }
    });
    engineState.actors.forEach((actor) => {
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
      if (!log || typeof log !== "object") return;
      if (log.actorId && log.skillId) {
        const pre = String(log.skillId).split("_")[0];
        if (!IGNORE_PREFIX[pre] && !prefixOwner[pre]) {
          prefixOwner[pre] = log.actorId;
        }
      }
      const rawValue = Number(log.value) || 0;
      const actualDamage = log.actualDamage != null ? Number(log.actualDamage) : rawValue;
      const isCounterSetup = detectCounterSetup(logs, index, log, rawValue);
      const isSelfDamage = log.type === "DAMAGE" && log.actorId && log.actorId === log.targetId;
      const isEnvironmentalPulse = ENVIRONMENTAL_SKILLS.has(log.skillId) || /脈衝波掃過/i.test(log.message || "");
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
        blocked: !!log.blocked || log.type === "BLOCK",
        actionCancelled: !!log.actionCancelled,
        skillId: log.skillId || "default",
        skillTier: log.skillTier || "normal",
        message: log.message || "",
        vfx: [],
        isBeneficial: false,
        hpDeltas: /* @__PURE__ */ new Map(),
        actorsHpState: /* @__PURE__ */ new Map(),
        turnNumber: currentTurn,
        actorsDeathState: /* @__PURE__ */ new Map(),
        actorsSummonState: /* @__PURE__ */ new Map(),
        isDeathEvent: false,
        deadActorId: null,
        isSummonEvent: false,
        summonedActorId: null,
        isDespawnEvent: false,
        despawnedActorId: null,
        actorsBondState: /* @__PURE__ */ new Map(),
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
      const isReactiveCoverText = frame.type === "SKILL_TEXT" && contractProfile && contractProfile.coverRegex.test(frame.message);
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
      if (log.type === "BUFF_APPLY") {
        const attacker = engineState.actors.get(log.actorId);
        const victim = engineState.actors.get(log.targetId);
        if (attacker && victim && attacker.side !== victim.side) {
          if (!buffSrc[victim.id]) buffSrc[victim.id] = {};
          buffSrc[victim.id][log.buffId || log.skillId || ""] = attacker.id;
          applyLog.push({ victim: victim.id, actor: attacker.id, msg: String(log.message || "") });
        }
        if (isBeneficialBuffSkill(frame.skillId) && log.targetId) {
          frame.vfx.push("flash-blue");
          frame.isBeneficial = true;
        }
      }
      if (["DAMAGE", "BLOCK", "COUNTER"].includes(log.type)) {
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
            if (frame.isCrit && !frame.blocked) frame.vfx.push("screen-shake", "flash-red");
            if (frame.blocked) frame.vfx.push("shield-block");
          }
          if (attacker && realDamage > 0 && log.type !== "BLOCK" && attacker.id !== target?.id) {
            attacker.totalDamageDealt += realDamage;
          }
        }
      } else if (log.type === "LUCK_EVENT") {
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
        frame.vfx.push("luck-drop");
        frame.vfx.push("flash-purple");
      } else if (log.type === "HEAL") {
        const target = engineState.actors.get(log.targetId || log.actorId);
        if (target) {
          if (!target.hideHp) {
            target.currentHp = Math.min(target.maxHp, target.currentHp + frame.value);
            addHpDelta(target.id, frame.value);
          } else {
            target.currentHp = target.maxHp;
          }
          frame.vfx.push("flash-green");
          frame.isBeneficial = true;
          if (target.currentHp > 0) {
            actorsDeathState.set(target.id, false);
          }
        }
        const healer = engineState.actors.get(log.actorId);
        const isDecayRestore = /離開毒氣|衰變的傷勢/.test(String(log.message || ""));
        if (healer && !isDecayRestore && frame.value > 0) {
          healer.totalHealingDealt += frame.value;
        }
      } else if (log.type === "HP_REMAINING") {
        const target = engineState.actors.get(log.actorId);
        if (target && log.maxHp && !target.isSummon) {
          target.maxHp = Number(log.maxHp);
          target.hideHp = false;
        }
      } else if (log.type === "SP_RECOVER") {
        const target = engineState.actors.get(log.targetId || log.actorId);
        if (target) {
          frame.vfx.push("flash-blue");
          frame.isBeneficial = true;
        }
      } else if (log.type === "BUFF_EFFECT") {
        const msg = String(log.message || "");
        const target = engineState.actors.get(log.actorId);
        if (target && frame.value) {
          if (log.buffType === "HOT" || /恢復|回復/.test(msg) && !/傷害|失去/.test(msg)) {
            if (!target.hideHp) {
              target.currentHp = Math.min(target.maxHp, target.currentHp + frame.value);
              addHpDelta(target.id, frame.value);
            } else {
              target.currentHp = target.maxHp;
            }
            frame.vfx.push("flash-green");
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
            frame.vfx.push("flash-purple");
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
              const pre = String(log.buffId).split("_")[0];
              const preActorId = prefixOwner[pre];
              const preActor = preActorId ? engineState.actors.get(preActorId) : null;
              if (preActor && preActor.side !== target.side) {
                sourceId = preActorId;
              }
            }
            if (!sourceId) {
              const opposingUnits = Array.from(engineState.actors.values()).filter(
                (u) => u.side !== target.side && !u.isSummon
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
      } else if (log.type === "MISS") {
        frame.vfx.push("dodge-blink");
      } else if (/TEXT|BUFF_APPLY/.test(String(log.type))) {
        const msg = String(log.message || "");
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
        if (contractProfile && log.type === "SKILL_TEXT") {
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
        const crossProfile2 = getCrossFinisherProfile(frame.skillId);
        if (crossProfile2 && log.type === "SKILL_TEXT" && crossProfile2.inscribeRegex.test(msg)) {
          frame.rosarioEvent = "INSCRIBE_CROSS";
        }
      }
      const crossProfile = getCrossFinisherProfile(frame.skillId);
      if (crossProfile && ["DAMAGE", "BLOCK"].includes(log.type) && crossProfile.pierceRegex.test(frame.message)) {
        frame.rosarioEvent = "PIERCE_CROSS";
      }
      if (["DEATH", "PLAYER_DEATH", "PLAYER_DEFEAT"].includes(log.type)) {
        const alreadyDead = !!actorsDeathState.get(log.actorId);
        actorsDeathState.set(log.actorId, true);
        if (!alreadyDead) {
          frame.isDeathEvent = true;
          frame.deadActorId = log.actorId;
        }
        const deadActor = engineState.actors.get(log.actorId);
        if (deadActor) deadActor.currentHp = 0;
      }
      engineState.actors.forEach((actor) => {
        frame.actorsHpState.set(actor.id, actor.currentHp);
      });
      frame.actorsDeathState = new Map(actorsDeathState);
      frame.actorsSummonState = new Map(actorsSummonState);
      frame.actorsBondState = new Map(actorsBondState);
      engineState.frames.push(frame);
    });
    calibrateHpWithAnchors(engineState.frames);
    markAOEWaves(engineState.frames);
    engineState.frames.forEach((f) => {
      if (f.isAOE) f.holdPositionForCover = false;
    });
    engineState.totalTurns = currentTurn;
  }

  // src/utils.js
  function escapeRegExp(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  function escapeHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function formatLogMessage(rawMessage, actorsMap) {
    const safeMsg = escapeHtml(rawMessage);
    const sortedActors = Array.from(actorsMap.values()).filter((a) => a && a.name).sort((a, b) => b.name.length - a.name.length);
    if (sortedActors.length === 0) return safeMsg;
    const sideByEscapedName = /* @__PURE__ */ new Map();
    const patterns = [];
    sortedActors.forEach((actor) => {
      const escapedHtmlName = escapeHtml(actor.name);
      if (!sideByEscapedName.has(escapedHtmlName)) {
        sideByEscapedName.set(escapedHtmlName, actor.side);
        patterns.push(escapeRegExp(escapedHtmlName));
      }
    });
    if (patterns.length === 0) return safeMsg;
    const regex = new RegExp(`(${patterns.join("|")})`, "g");
    return safeMsg.replace(regex, (match) => {
      const side = sideByEscapedName.get(match);
      const nameClass = side === "left" ? "actor-name-left" : "actor-name-right";
      return `<span class="${nameClass}">${match}</span>`;
    });
  }
  function getMessageReadingDuration(message = "") {
    if (!message) return 600;
    const len = message.trim().length;
    return Math.max(1e3, Math.min(4500, 650 + len * 75));
  }

  // src/styles.js
  var STAGE_STYLES = `
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    .stage { width: 100%; height: 100%; display: flex; flex-direction: column; background: radial-gradient(circle at center, #1a202c 0%, #000 100%); }

    /* Playback Controls */
    .controls { display: flex; padding: 10px 20px; background: #171923; border-bottom: 1px solid #2d3748; gap: 15px; align-items: center; position: relative; z-index: 2500; }
    .seek-container { flex: 1; display: flex; align-items: center; gap: 10px; color: #a0aec0; font-size: 14px; font-variant-numeric: tabular-nums; }
    #seek-label { min-width: 68px; text-align: right; white-space: nowrap; }
    input[type="range"] { flex: 1; accent-color: #4fd1c5; cursor: pointer; }
    button { background: #2c7a7b; color: #fff; border: 1px solid #4fd1c5; padding: 6px 16px; border-radius: 4px; cursor: pointer; font-weight: bold; transition: background 0.2s, transform 0.1s; white-space: nowrap; font-size: 14px; }
    button:hover { background: #319795; }
    button:active { transform: scale(0.97); }
    button.btn-skip, button.danger { background: #9b2c2c; border-color: #fc8181; color: #fff; }
    button.btn-skip:hover, button.danger:hover { background: #c53030; }
    @media (max-width: 640px) {
        .controls { padding: 8px 10px; gap: 6px; }
        .seek-container { gap: 6px; font-size: 12px; }
        #seek-label { min-width: 52px; }
        button { padding: 5px 9px; font-size: 12px; }
    }

    /* ATB / CTB Timeline Track */
    .ctb-container { height: 70px; background: rgba(0,0,0,0.8); border-bottom: 2px solid #4a5568; position: relative; z-index: 10; padding: 0 80px 0 40px; display: flex; align-items: center; box-shadow: 0 4px 10px rgba(0,0,0,0.5); }
    .ctb-track { position: relative; width: 100%; height: 4px; background: #4a5568; border-radius: 2px; }
    .ctb-action-point { position: absolute; right: -40px; top: -20px; width: 40px; height: 44px; border-left: 3px solid #f6e05e; display: flex; align-items: center; padding-left: 8px; color: #f6e05e; font-weight: bold; font-size: 12px; font-style: italic; box-shadow: -4px 0 8px -4px rgba(246,224,94,0.8); }
    .ctb-icon { position: absolute; top: -18px; width: 40px; height: 40px; border-radius: 50%; border: 2px solid #a0aec0; background: #1a202c; transform: translateX(-50%); transition: left 0.4s linear, opacity 0.2s ease; box-shadow: 0 2px 6px rgba(0,0,0,0.6); }
    .ctb-icon img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
    .ctb-icon.acting { border-color: #f6e05e; box-shadow: 0 0 15px #f6e05e; width: 50px; height: 50px; top: -23px; z-index: 999 !important; }
    .ctb-icon.left { border-color: #63b3ed; }
    .ctb-icon.right { border-color: #fc8181; }

    /* Battle Arena & Actor Cards */
    .arena { flex: 1; display: flex; justify-content: space-between; align-items: center; padding: 10px 5vw; position: relative; min-height: 0; overflow: hidden; }
    .team { display: flex; flex-direction: column; gap: 15px; align-items: center; align-content: center; width: 40%; max-height: 100%; }
    .left-team { justify-content: center; flex-wrap: wrap; }
    .right-team { justify-content: center; flex-wrap: wrap-reverse; }
    .actor { display: flex; flex-direction: column; align-items: center; transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275); position: relative; }
    .actor.unspawned { display: none !important; }
    .actor.spawning { animation: summonSpawn 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
    .actor.despawning { animation: summonDespawn 0.45s cubic-bezier(0.16, 1, 0.3, 1) forwards; pointer-events: none; }
    .actor.dead { filter: grayscale(100%) brightness(50%) contrast(120%); opacity: 0.7; transition: filter 0.3s ease, opacity 0.3s ease; pointer-events: none; }
    .actor-name { color: #e2e8f0; font-size: 14px; font-weight: bold; margin-bottom: 8px; text-shadow: 0 2px 4px rgba(0,0,0,0.8); background: rgba(0,0,0,0.6); padding: 2px 8px; border-radius: 4px; border: 1px solid #4a5568; }
    .avatar-wrapper { position: relative; }
    .avatar { width: 80px; height: 80px; border-radius: 8px; border: 2px solid #4a5568; object-fit: cover; box-shadow: 0 8px 12px -3px rgba(0,0,0,0.6); }

    .hp-container { width: 80px; height: 12px; background: #2d3748; border-radius: 6px; margin-top: 8px; overflow: hidden; position: relative; border: 1px solid #1a202c; }
    .hp-fill { height: 100%; background: #48bb78; transition: width 0.3s ease-out, background-color 0.3s; }
    .hp-fill.warning { background: #ecc94b; }
    .hp-fill.danger { background: #f56565; }
    .hp-text { position: absolute; width: 100%; text-align: center; top: -1px; font-size: 11px; color: #fff; font-weight: bold; text-shadow: 0 1px 2px #000; }

    /* Dice Check & Status Badges */
    .dice-badge { position: absolute; top: -32px; left: 50%; transform: translateX(-50%); padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 800; color: #fff; white-space: nowrap; z-index: 55; pointer-events: none; box-shadow: 0 4px 10px rgba(0,0,0,0.6); animation: slideInUp 0.2s ease-out forwards; }
    .dice-pass { background: rgba(47, 133, 90, 0.95); border: 1px solid #68d391; }
    .dice-fail { background: rgba(197, 48, 48, 0.95); border: 1px solid #fc8181; }
    .dice-roll { background: rgba(43, 108, 176, 0.95); border: 1px solid #63b3ed; }
    .dice-warn { background: rgba(183, 121, 31, 0.95); border: 1px solid #f6e05e; }

    /* Combat Log Dialog Box */
    .dialog-box { height: 160px; background: linear-gradient(180deg, rgba(15, 23, 42, 0.9) 0%, rgba(0, 0, 0, 0.95) 100%); border-top: 2px solid #4fd1c5; padding: 10px 15px; color: #cbd5e1; font-family: "Segoe UI", Roboto, Helvetica, sans-serif; font-size: 14px; overflow-y: auto; scroll-behavior: smooth; box-shadow: inset 0 4px 6px rgba(0,0,0,0.5); }
    .log-line { margin-bottom: 4px; padding: 4px 8px; border-radius: 4px; animation: slideInUp 0.2s ease-out forwards; opacity: 0; line-height: 1.5; cursor: pointer; transition: background 0.15s ease, padding-left 0.15s ease, border-color 0.15s ease; user-select: text; border-left: 3px solid transparent; }
    .log-line:hover { background: rgba(255, 255, 255, 0.08); padding-left: 12px; }
    .log-line:hover .log-index { color: #81e6d9 !important; font-weight: 700; }
    .log-line.system-log { background: rgba(255, 255, 255, 0.03); border-left-color: transparent; }
    .log-line.system-log:hover { background: rgba(255, 255, 255, 0.08); border-left-color: #81e6d9; }
    .log-line.dialogue-log { background: rgba(79, 209, 197, 0.1); border-left: 3px solid #4fd1c5; color: #e2e8f0; font-weight: 500; }
    .log-line.dialogue-log:hover { background: rgba(79, 209, 197, 0.22); border-left-color: #81e6d9; }
    .log-line.narrative-log { background: rgba(255, 255, 255, 0.04); border-left: 3px solid #718096; color: #f1f5f9; font-style: italic; }
    .log-line.narrative-log:hover { background: rgba(255, 255, 255, 0.1); border-left-color: #cbd5e1; }
    .actor-name-left { font-weight: bold; color: #90cdf4; }
    .actor-name-right { font-weight: bold; color: #feb2b2; }

    /* Actor Speech Bubbles */
    .speech-bubble { position: absolute; top: -25px; background: rgba(15, 23, 42, 0.95); color: #f8fafc; padding: 12px 18px; border-radius: 12px; font-weight: normal; font-size: 15px; line-height: 1.5; max-width: 350px; width: max-content; word-wrap: break-word; box-shadow: 0 8px 16px rgba(0,0,0,0.6); z-index: 60; pointer-events: none; backdrop-filter: blur(4px); border: 1px solid; }
    .left-bubble { left: 85%; border-bottom-left-radius: 0; border-color: #63b3ed; }
    .left-bubble::after { content: ''; position: absolute; bottom: -10px; left: -1px; border-width: 10px 15px 0 0; border-style: solid; border-color: rgba(15, 23, 42, 0.95) transparent transparent transparent; }
    .right-bubble { right: 85%; border-bottom-right-radius: 0; border-color: #fc8181; }
    .right-bubble::after { content: ''; position: absolute; bottom: -10px; right: -1px; border-width: 10px 0 0 15px; border-style: solid; border-color: rgba(15, 23, 42, 0.95) transparent transparent transparent; }

    /* Floating Combat Text & Stamps */
    .floating-text { position: absolute; top: 30%; left: 50%; transform: translate(-50%, 0); font-size: 32px; font-weight: 900; color: #fff; text-shadow: 0 4px 6px rgba(0,0,0,1); animation: floatUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards; pointer-events: none; z-index: 20; white-space: nowrap; }
    .floating-crit { color: #fc8181; font-size: 46px; font-style: italic; filter: drop-shadow(0 0 8px #c53030); }
    .floating-block { color: #90cdf4; font-size: 26px; font-style: italic; text-shadow: 0 0 10px rgba(66, 153, 225, 0.9), 0 2px 4px #000; letter-spacing: 1px; }

    .combo-text { position: absolute; top: 10%; right: -60px; font-size: 40px; font-weight: 900; color: #f6ad55; font-style: italic; text-shadow: 0 4px 10px rgba(221, 107, 32, 0.8); animation: comboPop 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; pointer-events: none; z-index: 25; white-space: nowrap; }
    .break-stamp { position: absolute; top: 38%; left: 50%; transform: translate(-50%, -50%) rotate(-12deg) scale(1); font-size: 24px; font-weight: 900; color: #fc8181; border: 3px solid #e53e3e; padding: 2px 8px; border-radius: 6px; background: rgba(15, 23, 42, 0.88); text-shadow: 0 2px 6px rgba(0,0,0,0.9); box-shadow: 0 0 12px rgba(229, 62, 62, 0.6); opacity: 0; animation: stampDown 0.45s cubic-bezier(0.16, 1, 0.3, 1) forwards; pointer-events: none; z-index: 45; white-space: nowrap; }
    .luck-drop { position: absolute; top: -90px; left: 50%; transform: translateX(-50%); font-size: 44px; animation: dropDown 0.45s ease-in forwards; z-index: 40; pointer-events: none; }

    /* Ultimate Cut-In Overlay */
    .ultimate-overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: #000; z-index: 2000; display: flex; align-items: center; justify-content: center; opacity: 0; pointer-events: none; overflow: hidden; }
    .ultimate-overlay.active { animation: ult-bg-hold 2.5s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
    .ult-flash { position: absolute; width: 100%; height: 100%; background: #fff; z-index: 2010; animation: ult-flash-bang 2.5s ease-out forwards; }
    .ultimate-avatar-bg { position: absolute; width: 100%; height: 100%; object-fit: cover; object-position: center 25%; transform-origin: center 25%; opacity: 0.8; filter: grayscale(70%) contrast(160%) brightness(0.7); z-index: 2001; animation: ult-bg-zoom 2.5s ease-out forwards; }
    .ultimate-vignette { position: absolute; width: 100%; height: 100%; z-index: 2002; background: radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.8) 80%, #000 100%); }
    .ult-text-wrapper { position: absolute; z-index: 2005; height: 90%; top: 5%; writing-mode: vertical-rl; text-align: center; }
    .ult-text-wrapper.left-side { right: 8%; }
    .ult-text-wrapper.right-side { left: 8%; }
    .ult-quote { display: inline-block; margin-left: 2vw; font-family: "Yu Mincho", "Noto Serif TC", "PMingLiU", serif; font-weight: 900; color: #fff; text-shadow: 0 0 15px rgba(255,255,255,0.8), -3px 3px 0px #000, -8px 8px 0px rgba(180, 0, 0, 0.9); animation: ult-stamp 2.5s cubic-bezier(0.1, 1, 0.2, 1) forwards; }
    .ult-quote.lang-zh { font-size: clamp(30px, 7vh, 70px); text-orientation: mixed; letter-spacing: 1vh; }
    .ult-quote.lang-en { font-size: clamp(24px, 6vh, 60px); text-orientation: mixed; letter-spacing: 4px; }
    .ult-flavor { display: inline-block; font-family: "Yu Mincho", "Noto Serif TC", "PMingLiU", serif; font-size: clamp(14px, 2.5vh, 22px); color: #e2e8f0; text-shadow: -2px 2px 4px #000; text-orientation: mixed; letter-spacing: 0.5vh; animation: ult-stamp-delay 2.5s cubic-bezier(0.1, 1, 0.2, 1) forwards; }

    /* Low HP Danger Pulse */
    @keyframes panting-pulse { 0%, 100% { filter: drop-shadow(0 0 4px #e53e3e); transform: scale(1); } 50% { filter: drop-shadow(0 0 15px #c53030); transform: scale(1.03); } }
    .actor.danger-state .avatar { animation: panting-pulse 1.2s infinite ease-in-out; border: 2px solid #e53e3e; }

    /* Fatality Letterbox & Slash Effect */
    .fatality-overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.4); backdrop-filter: blur(2px); z-index: 1500; opacity: 0; pointer-events: none; transition: opacity 0.3s; }
    .fatality-overlay::before, .fatality-overlay::after { content: ''; position: absolute; left: 0; width: 100%; height: 12vh; background: #000; transition: transform 0.3s cubic-bezier(0.1, 1, 0.2, 1); }
    .fatality-overlay::before { top: 0; transform: translateY(-100%); }
    .fatality-overlay::after { bottom: 0; transform: translateY(100%); }
    .fatality-overlay.active { opacity: 1; }
    .fatality-overlay.active::before, .fatality-overlay.active::after { transform: translateY(0); }

    .fatality-slash { position: absolute; top: 50%; left: -20%; width: 140%; height: 3px; background: #fff; box-shadow: 0 0 10px #fff, 0 0 20px #fc8181; transform-origin: center; z-index: 1501; pointer-events: none; }
    @keyframes slash-strike { 0% { transform: rotate(-25deg) scaleX(0); opacity: 1; } 20% { transform: rotate(-25deg) scaleX(1); opacity: 1; } 100% { transform: rotate(-25deg) scaleX(1.2); opacity: 0; filter: blur(4px); } }

    .fatality-text { position: absolute; top: 50%; left: 50%; font-size: 64px; font-family: Impact, "Arial Black", sans-serif; font-style: italic; color: #fc8181; -webkit-text-stroke: 1px #fff; text-shadow: 4px 4px 0px rgba(0,0,0,0.8); z-index: 1502; opacity: 0; pointer-events: none; }
    @keyframes text-pop { 0% { transform: translate(-50%, -50%) skewX(-15deg) scale(2); opacity: 0; } 15% { transform: translate(-50%, -50%) skewX(-15deg) scale(1); opacity: 1; } 80% { transform: translate(-50%, -50%) skewX(-15deg) scale(1); opacity: 1; } 100% { transform: translate(-50%, -50%) skewX(-15deg) scale(0.9); opacity: 0; } }

    /* Keyframe Animations */
    @keyframes summonSpawn { 0% { opacity: 0; transform: scale(0.3) translateY(-30px); filter: brightness(3) drop-shadow(0 0 20px #fc8181); } 100% { opacity: 1; transform: scale(1) translateY(0); filter: brightness(1); } }
    @keyframes summonDespawn { 0% { opacity: 1; transform: scale(1) translateY(0); filter: brightness(1); } 100% { opacity: 0; transform: scale(0.4) translateY(-25px); filter: brightness(2.5) blur(3px); } }
    @keyframes ult-bg-hold { 0%, 100% { opacity: 0; } 5%, 95% { opacity: 1; } }
    @keyframes ult-flash-bang { 0% { opacity: 1; } 12% { opacity: 0; } 100% { opacity: 0; } }
    @keyframes ult-bg-zoom { 0% { transform: scale(1.15); filter: grayscale(0%) contrast(100%) brightness(0.9); } 10% { filter: grayscale(70%) contrast(160%) brightness(0.55); } 100% { transform: scale(1); filter: grayscale(70%) contrast(160%) brightness(0.55); } }
    @keyframes ult-stamp { 0% { transform: scale(3); opacity: 0; filter: blur(10px); } 10% { transform: scale(1); opacity: 1; filter: blur(0px); } 100% { transform: scale(1); opacity: 1; } }
    @keyframes ult-stamp-delay { 0%, 12% { transform: scale(2); opacity: 0; filter: blur(5px); } 18% { transform: scale(1); opacity: 1; filter: blur(0px); } 100% { transform: scale(1); opacity: 1; } }
    @keyframes slideInUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes floatUp { 0% { opacity: 1; transform: translate(-50%, 0) scale(0.8); } 20% { transform: translate(-50%, -10px) scale(1.2); } 100% { opacity: 0; transform: translate(-50%, -60px) scale(1); } }
    @keyframes shake { 0%, 100% { transform: translateX(0); } 20%, 60% { transform: translateX(-8px); } 40%, 80% { transform: translateX(8px); } }
    @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.2; filter: blur(2px); } }
    @keyframes comboPop { 0% { opacity: 0; transform: scale(0.5) translateX(-20px); } 50% { transform: scale(1.2) translateX(0); } 100% { opacity: 1; transform: scale(1) translateX(0); } }
    @keyframes stampDown { 0% { opacity: 0; transform: translate(-50%, -50%) rotate(-12deg) scale(2.2); } 40% { opacity: 1; transform: translate(-50%, -50%) rotate(-12deg) scale(0.95); } 100% { opacity: 0.95; transform: translate(-50%, -50%) rotate(-12deg) scale(1); } }
    @keyframes dropDown { 0% { top: -110px; opacity: 0; transform: translateX(-50%) rotate(0deg); } 80% { top: 10px; opacity: 1; transform: translateX(-50%) rotate(20deg); } 100% { top: 20px; opacity: 0; transform: translateX(-50%) rotate(30deg); } }

    .shake-active { animation: shake 0.3s ease-in-out; }
    .blink-active { animation: blink 0.3s ease-in-out; }

    /* SAO Contract Cut-In & Bond System */
    .contract-cutin-overlay { position: absolute; inset: 0; z-index: 1800; display: flex; align-items: center; justify-content: center; pointer-events: none; overflow: hidden; animation: contract-overlay-fade ease-out forwards; }
    @keyframes contract-overlay-fade { 0% { opacity: 0; } 12% { opacity: 1; } 85% { opacity: 1; } 100% { opacity: 0; } }
    .contract-backdrop { position: absolute; inset: 0; background: linear-gradient(135deg, rgba(20, 10, 28, 0.85) 0%, rgba(246, 135, 179, 0.28) 50%, rgba(15, 23, 42, 0.88) 100%); backdrop-filter: blur(4px); }
    .contract-portraits-layer, .contract-Portraits-layer { position: absolute; inset: 0; display: flex; align-items: center; justify-content: space-between; padding: 0 8vw; }
    .contract-cutin-overlay.solo-mode .contract-portraits-layer, .contract-cutin-overlay.solo-mode .contract-Portraits-layer { justify-content: center; }
    .contract-portrait { display: flex; flex-direction: column; align-items: center; gap: 8px; filter: drop-shadow(0 0 24px rgba(246, 135, 179, 0.7)); }
    .contract-portrait img { width: 140px; height: 140px; object-fit: cover; border-radius: 50%; border: 4px solid #fbb6ce; background: #1a202c; }
    .contract-portrait.left-partner { animation: slide-in-left-partner 0.45s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
    .contract-portrait.right-partner { animation: slide-in-right-partner 0.45s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
    @keyframes slide-in-left-partner { from { transform: translateX(-120px) scale(0.85); opacity: 0; } to { transform: translateX(0) scale(1); opacity: 1; } }
    @keyframes slide-in-right-partner { from { transform: translateX(120px) scale(0.85); opacity: 0; } to { transform: translateX(0) scale(1); opacity: 1; } }
    .contract-partner-name { background: rgba(26, 32, 44, 0.9); color: #fff5f7; padding: 4px 14px; border-radius: 999px; font-size: 15px; font-weight: 700; border: 1px solid #f687b3; }

    .sao-modal-card { position: relative; z-index: 2; width: min(420px, 82vw); background: rgba(245, 247, 250, 0.95); border: 2px solid #cbd5e0; border-radius: 6px; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.65), 0 0 30px rgba(246, 135, 179, 0.55); color: #2d3748; overflow: hidden; animation: sao-modal-pop 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; }
    @keyframes sao-modal-pop { 0% { transform: scaleY(0.05) scaleX(0.6); opacity: 0; } 60% { transform: scaleY(1.04) scaleX(1.02); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
    .sao-modal-header { background: linear-gradient(90deg, #4a5568, #2d3748); color: #edf2f7; font-size: 12px; font-weight: 800; letter-spacing: 1.5px; padding: 8px 14px; text-align: center; border-bottom: 2px solid #f687b3; }
    .sao-modal-body { padding: 18px 20px 14px; text-align: center; }
    .sao-modal-couple { font-size: 20px; font-weight: 900; color: #1a202c; margin-bottom: 6px; display: flex; align-items: center; justify-content: center; gap: 10px; }
    .sao-modal-desc { font-size: 14px; color: #4a5568; font-weight: 600; }
    .sao-modal-footer { display: flex; justify-content: center; gap: 36px; padding: 10px 0 16px; background: rgba(237, 242, 247, 0.8); border-top: 1px solid #e2e8f0; }
    .sao-btn { width: 38px; height: 38px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 900; border: 2px solid #a0aec0; background: #fff; transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease; }
    .sao-btn-accept { color: #ed8936; border-color: #ed8936; }
    .sao-btn-accept.pressed { background: #ed8936; color: #fff; transform: scale(1.25); box-shadow: 0 0 20px #f6ad55, 0 0 35px #f687b3; }
    .sao-btn-cancel { color: #718096; }

    /* Persistent Marriage Bond Aura & Cover Shield */
    .actor.bond-active .avatar { border-color: #f687b3; box-shadow: 0 0 16px rgba(246, 135, 179, 0.85); }
    .bond-ring-badge { position: absolute; top: -10px; right: -12px; background: linear-gradient(135deg, #d53f8c, #b83280); color: #fff; font-size: 11px; font-weight: 800; padding: 2px 8px; border-radius: 999px; border: 1.5px solid #fbb6ce; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.6); z-index: 30; white-space: nowrap; pointer-events: none; }
    .bridal-cover-shield { position: absolute; inset: -10px; border: 3px solid #fbb6ce; border-radius: 14px; background: radial-gradient(circle, rgba(246, 135, 179, 0.35) 0%, transparent 75%); box-shadow: 0 0 20px #f687b3; display: flex; align-items: flex-start; justify-content: center; z-index: 20; pointer-events: none; }
    .bridal-cover-shield span { margin-top: -12px; background: #d53f8c; color: #fff; font-size: 11px; font-weight: 900; padding: 1px 8px; border-radius: 999px; border: 1px solid #fff; }

    /* Mother's Rosario 10-Hit Cross Emblem */
    .rosario-cross-mark { position: absolute; inset: -15px; z-index: 35; pointer-events: none; display: flex; align-items: center; justify-content: center; }
    .rosario-line { position: absolute; width: 140%; height: 5px; background: linear-gradient(90deg, transparent, #fff, var(--cross-color, #f687b3), #fff, transparent); box-shadow: 0 0 14px var(--cross-color, #f687b3), 0 0 24px var(--glow-color, #b794f4); border-radius: 999px; }
    .rosario-line.line-1 { --slash-angle: 38deg; transform: rotate(var(--slash-angle)); animation: rosario-slash-in 0.22s ease-out forwards; }
    .rosario-line.line-2 { --slash-angle: -38deg; transform: rotate(var(--slash-angle)); animation: rosario-slash-in 0.22s 0.08s ease-out backwards; }
    .rosario-core { width: 22px; height: 22px; border-radius: 50%; background: #fff; box-shadow: 0 0 20px #fff, 0 0 35px var(--cross-color, #f687b3); animation: rosario-core-pulse 0.4s infinite alternate; }
    .rosario-cross-mark.shatter { animation: rosario-shatter 0.4s ease-out forwards; }
    @keyframes rosario-slash-in { from { transform: rotate(var(--slash-angle, 38deg)) scaleX(0); opacity: 0; } to { transform: rotate(var(--slash-angle, 38deg)) scaleX(1); opacity: 1; } }
    @keyframes rosario-core-pulse { from { transform: scale(0.85); } to { transform: scale(1.35); } }
    @keyframes rosario-shatter { 0% { transform: scale(1); filter: brightness(2); opacity: 1; } 100% { transform: scale(2.1); filter: brightness(3) blur(4px); opacity: 0; } }

    /* Seek / Step Situation HUD Banner & Active Combat Highlights */
    .log-line.current-frame-log { background: rgba(79, 209, 197, 0.2); border-left: 3px solid #f6e05e !important; color: #fff; box-shadow: inset 0 0 12px rgba(246, 224, 94, 0.15); }
    .log-line.current-frame-log:hover { background: rgba(79, 209, 197, 0.3); border-left-color: #f6e05e; }
    .seek-situation-banner { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 75; background: rgba(15, 23, 42, 0.94); border: 1px solid #4fd1c5; border-top: 3px solid #f6e05e; border-radius: 10px; padding: 8px 16px; color: #f8fafc; box-shadow: 0 10px 25px rgba(0, 0, 0, 0.78), 0 0 15px rgba(79, 209, 197, 0.25); backdrop-filter: blur(6px); display: flex; flex-direction: column; gap: 4px; max-width: min(720px, 88vw); min-width: 280px; pointer-events: none; animation: slideInUp 0.15s ease-out forwards; }
    .seek-banner-header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; font-weight: 800; color: #a0aec0; border-bottom: 1px solid rgba(255, 255, 255, 0.1); padding-bottom: 4px; }
    .seek-turn-pill { background: #f6e05e; color: #1a202c; padding: 1px 7px; border-radius: 999px; font-size: 11px; font-weight: 900; letter-spacing: 0.5px; }
    .seek-skill-pill { background: rgba(79, 209, 197, 0.2); color: #81e6d9; border: 1px solid #4fd1c5; padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 800; }
    .seek-skill-context { font-size: 12px; color: #fbd38d; font-style: italic; opacity: 0.95; }
    .seek-banner-body { font-size: 14px; line-height: 1.45; color: #edf2f7; font-weight: 600; }
    .actor.seek-acting .avatar { border-color: #f6e05e; box-shadow: 0 0 18px #f6e05e, 0 0 30px rgba(246, 224, 94, 0.5); }
    .actor.seek-targeted .avatar { border-color: #fc8181; box-shadow: 0 0 18px #fc8181, 0 0 28px rgba(252, 129, 129, 0.6); }

    /* True AOE Fan Shockwave & Multi-Projectile Barrage VFX */
    .aoe-fan-wave { position: absolute; width: 160px; height: 340px; pointer-events: none; z-index: 18; mix-blend-mode: screen; filter: blur(1px); }
    .aoe-fan-wave.wave-right { border-right: 14px solid var(--wave-color, #fc8181); border-top: 4px solid transparent; border-bottom: 4px solid transparent; border-radius: 0 180px 180px 0; box-shadow: 18px 0 28px -4px var(--wave-color, #fc8181), inset -14px 0 22px -6px #ffffff; }
    .aoe-fan-wave.wave-left { border-left: 14px solid var(--wave-color, #4fd1c5); border-top: 4px solid transparent; border-bottom: 4px solid transparent; border-radius: 180px 0 0 180px; box-shadow: -18px 0 28px -4px var(--wave-color, #4fd1c5), inset 14px 0 22px -6px #ffffff; }
    .aoe-projectile { position: absolute; width: 72px; height: 16px; border-radius: 999px; pointer-events: none; z-index: 19; mix-blend-mode: screen; background: linear-gradient(90deg, transparent 0%, var(--proj-color, #fc8181) 45%, #ffffff 90%, #ffffff 100%); box-shadow: 0 0 16px var(--proj-color, #fc8181), 0 0 28px #ffffff; transform-origin: center center; }

    /* Environmental Battlefield Hazard Wave & Scene Narration Subtitle Banner */
    .arena-field-wave { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 38; background: radial-gradient(circle at 50% 50%, rgba(229, 62, 62, 0.45) 0%, rgba(183, 28, 28, 0.22) 50%, transparent 80%); opacity: 0; animation: arenaFieldPulse 0.95s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
    @keyframes arenaFieldPulse { 0% { opacity: 0; transform: scale(0.65); } 30% { opacity: 1; transform: scale(1.04); } 70% { opacity: 0.85; transform: scale(1); } 100% { opacity: 0; transform: scale(1.15); filter: blur(4px); } }

    .scene-narration-banner { position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); max-width: 86%; padding: 8px 20px; background: rgba(15, 23, 42, 0.92); border: 1px solid rgba(226, 232, 240, 0.25); border-radius: 8px; color: #f1f5f9; font-family: "Yu Mincho", "Noto Serif TC", "PMingLiU", serif; font-size: 14px; font-style: italic; line-height: 1.6; text-align: center; letter-spacing: 0.5px; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9); box-shadow: 0 6px 20px rgba(0, 0, 0, 0.7); backdrop-filter: blur(4px); pointer-events: none; z-index: 55; animation: narrationFadeIn 0.35s ease-out forwards; white-space: pre-line; }
    .scene-narration-banner.fade-out { animation: narrationFadeOut 0.4s ease-in forwards; }
    @keyframes narrationFadeIn { from { opacity: 0; transform: translate(-50%, 10px); } to { opacity: 1; transform: translate(-50%, 0); } }
    @keyframes narrationFadeOut { from { opacity: 1; transform: translate(-50%, 0); } to { opacity: 0; transform: translate(-50%, -8px); } }


    /* Timeline Milestone Event Pins & Tooltips */
    .seek-track-wrapper { position: relative; flex: 1; display: flex; align-items: center; height: 32px; }
    .seek-track-wrapper input[type="range"] { width: 100%; margin: 0; position: relative; z-index: 2; }
    .seek-markers-layer { position: absolute; left: 7px; right: 7px; top: 0; height: 100%; pointer-events: none; z-index: 3; }
    .seek-pin { position: absolute; top: 1px; transform: translateX(-50%) scale(0.6); width: 10px; height: 10px; border-radius: 50%; border: 1.5px solid #fff; cursor: pointer; pointer-events: none; opacity: 0; padding: 0; transition: opacity 0.2s ease, transform 0.15s ease, box-shadow 0.15s ease; z-index: 4; }
    .seek-container:hover .seek-pin, .seek-track-wrapper:hover .seek-pin { opacity: 1; pointer-events: auto; transform: translateX(-50%) scale(1); }
    .seek-container:hover .seek-pin:hover, .seek-track-wrapper:hover .seek-pin:hover { transform: translateX(-50%) scale(1.65); z-index: 50; }
    .seek-pin.pin-ultimate { background: #f6e05e; box-shadow: 0 0 8px #f6e05e; }
    .seek-pin.pin-death { background: #fc8181; box-shadow: 0 0 8px #e53e3e; }
    .seek-pin.pin-rebirth { background: #48bb78; box-shadow: 0 0 10px #48bb78; }
    .seek-pin.pin-contract { background: #f687b3; box-shadow: 0 0 8px #f687b3; }
    .seek-pin.pin-summon { background: #63b3ed; box-shadow: 0 0 8px #63b3ed; }
    .seek-pin-tooltip { position: absolute; top: 20px; left: 50%; transform: translateX(-50%) translateY(-4px); background: rgba(15, 23, 42, 0.98); color: #f8fafc; border: 1px solid #4fd1c5; border-radius: 6px; padding: 6px 10px; font-size: 12px; font-weight: 600; white-space: nowrap; pointer-events: none; opacity: 0; visibility: hidden; transition: opacity 0.15s ease, transform 0.15s ease; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.9); z-index: 9999; text-align: left; }
    .seek-pin-tooltip.tooltip-align-left { left: 0; transform: translateY(-4px); }
    .seek-pin-tooltip.tooltip-align-right { left: auto; right: 0; transform: translateY(-4px); }
    .seek-pin:hover .seek-pin-tooltip { opacity: 1; visibility: visible; transform: translateX(-50%) translateY(0); }
    .seek-pin:hover .seek-pin-tooltip.tooltip-align-left { transform: translateY(0); }
    .seek-pin:hover .seek-pin-tooltip.tooltip-align-right { transform: translateY(0); }
    .seek-pin-tooltip-title { color: #f6e05e; font-weight: 800; margin-bottom: 2px; display: block; }
    .seek-pin-tooltip-detail { color: #cbd5e1; font-size: 11px; font-weight: 500; display: block; max-width: 280px; overflow: hidden; text-overflow: ellipsis; }

    /* Report Export/Import Buttons, Hotkey Popover & Drag-Drop Overlay */
    button.btn-io { background: #2b6cb0; border-color: #63b3ed; padding: 6px 10px; color: #ebf8ff; }
    button.btn-io:hover { background: #3182ce; }
    .hotkey-wrapper { position: relative; display: inline-flex; align-items: center; }
    button.btn-hotkey { background: #1a202c; border-color: #4a5568; padding: 6px 9px; color: #a0aec0; font-size: 12px; }
    button.btn-hotkey:hover { color: #fff; border-color: #4fd1c5; }
    .hotkey-popover { position: absolute; top: calc(100% + 8px); right: 0; background: rgba(15, 23, 42, 0.97); border: 1px solid #4fd1c5; border-radius: 8px; padding: 10px 14px; color: #e2e8f0; font-size: 12px; line-height: 1.7; white-space: nowrap; box-shadow: 0 12px 28px rgba(0,0,0,0.85); z-index: 2600; opacity: 0; visibility: hidden; pointer-events: none; transition: opacity 0.15s ease; min-width: 250px; }
    .hotkey-wrapper:hover .hotkey-popover { opacity: 1; visibility: visible; }
    .hotkey-title { font-weight: 800; color: #4fd1c5; border-bottom: 1px solid rgba(255,255,255,0.12); padding-bottom: 3px; margin-bottom: 4px; font-size: 12px; }
    .hotkey-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
    .hotkey-popover kbd, .hotkey-kbd { background: #2d3748; border: 1px solid #718096; border-radius: 4px; padding: 0px 6px; font-family: monospace; font-size: 11px; color: #f6e05e; }
    .drag-drop-overlay { position: absolute; inset: 0; background: rgba(15, 23, 42, 0.88); border: 4px dashed #4fd1c5; z-index: 4000; display: none; align-items: center; justify-content: center; color: #f6e05e; pointer-events: none; backdrop-filter: blur(4px); }
    .drag-drop-overlay.active { display: flex; }
    .drag-drop-box { text-align: center; padding: 28px 40px; border-radius: 16px; background: rgba(26, 32, 44, 0.9); border: 1px solid rgba(79, 209, 197, 0.5); box-shadow: 0 20px 50px rgba(0,0,0,0.8); }
    .drag-drop-title { font-size: 26px; font-weight: 900; color: #f6e05e; letter-spacing: 1.5px; margin-bottom: 8px; }
    .drag-drop-sub { font-size: 14px; color: #cbd5e1; font-weight: 600; }
`;

  // src/cinematics.js
  function stripCombatOutcomeText(rawText, actorName = "") {
    let text = String(rawText || "");
    if (actorName) {
      const escapedActorName = escapeRegExp(actorName);
      text = text.replace(new RegExp(`^${escapedActorName}[\uFF1A:]?\\s*(\u7684\\s*)?`), "");
    }
    text = text.replace(/^[第輪次]\s*\d+\s*[擊輪次劍枚][，,、\s]*/g, "").replace(/[，,、]?\s*(?:會心一擊|精準劃過要害|正中要害)[！!]?/g, "").replace(/[，,、]?\s*但是被\s*.+?\s*用.+?抵擋[，,]?\s*(?:造成了?|受到)\s*\d+\s*點(?:真實)?傷害[！!]?/g, "").replace(/[，,、]?\s*但是被\s*.+?\s*躲開了[！!]?/g, "").replace(/[，,、]?\s*但是遭\s*.+?\s*反擊[，,]?\s*(?:會心一擊[！!]?\s*)?(?:造成了?|受到)\s*\d+\s*點(?:真實)?傷害[！!]?/g, "").replace(/[，,、]?\s*(?:(?:對|在)\s*.+?\s*|(?:[^\s，,。]+?\s*))?(?:命中並\s*)?(?:造成了?|受到)\s*\d+\s*點(?:真實)?傷害[！!。.]?/g, "").replace(/[—─ー―-]+$/g, "").replace(/^[，,、：:\s]+/, "").replace(/[，,、\s]+$/, "").trim();
    if (text.length > 0 && !/[。！!?.」…]$/.test(text)) {
      text += "\u2026\u2026";
    }
    return text;
  }
  async function playFatalitySequence(sr, actorId, token = engineState.playbackToken) {
    const overlay = sr.getElementById("fatality-overlay");
    const actorEl = sr.getElementById(`actor-${actorId}`);
    if (!overlay || !actorEl || engineState.playbackToken !== token) return;
    engineState.timeScale = 0.25;
    try {
      const effectiveSpeed = getEffectiveSpeed();
      overlay.classList.add("active");
      const slash = document.createElement("div");
      slash.className = "fatality-slash";
      const durationSlash = 500 / effectiveSpeed;
      slash.style.animation = `slash-strike ${durationSlash}ms cubic-bezier(0.1, 1, 0.2, 1) forwards`;
      actorEl.appendChild(slash);
      const deathText = document.createElement("div");
      deathText.className = "fatality-text";
      deathText.textContent = "K.O.";
      const durationText = 1500 / effectiveSpeed;
      deathText.style.animation = `text-pop ${durationText}ms cubic-bezier(0.1, 1, 0.2, 1) forwards`;
      deathText.style.animationDelay = `${100 / effectiveSpeed}ms`;
      actorEl.appendChild(deathText);
      await new Promise((resolve) => setTimeout(resolve, 600 / effectiveSpeed));
      if (engineState.playbackToken === token) {
        overlay.classList.remove("active");
      }
      setTimeout(() => {
        if (slash.isConnected) slash.remove();
        if (deathText.isConnected) deathText.remove();
      }, 1e3);
    } finally {
      if (engineState.playbackToken === token) {
        engineState.timeScale = 1;
      }
    }
  }
  async function playUltimateCutIn(frame, sr, token) {
    const actor = engineState.actors.get(frame.actorId);
    if (!actor || engineState.playbackToken !== token) return;
    const arena = sr.getElementById("arena");
    if (!arena) return;
    const overlay = document.createElement("div");
    overlay.className = "ultimate-overlay active";
    const flash = document.createElement("div");
    flash.className = "ult-flash";
    const bgImg = document.createElement("img");
    bgImg.src = actor.avatar;
    bgImg.className = "ultimate-avatar-bg";
    const vignette = document.createElement("div");
    vignette.className = "ultimate-vignette";
    const textWrapper = document.createElement("div");
    textWrapper.className = `ult-text-wrapper ${actor.side === "left" ? "left-side" : "right-side"}`;
    let mainText = "";
    let subText = "";
    const spokenQuoteMatch = frame.message.match(/[：:]\s*「([^」]+)」/);
    if (spokenQuoteMatch && spokenQuoteMatch[1].length <= 15) {
      mainText = spokenQuoteMatch[1];
      const rawRemainingText = frame.message.replace(actor.name, "").replace(/[：:]\s*「[^」]+」\s*/, " ").trim();
      subText = stripCombatOutcomeText(rawRemainingText, actor.name);
    } else {
      let extractedSkillName = null;
      const skillMatchCurrent = frame.message.match(/使出了\s*([^，,。！!—\s]+)/);
      if (skillMatchCurrent) {
        extractedSkillName = skillMatchCurrent[1];
      } else {
        const nextFrame = engineState.frames[frame.index + 1];
        if (nextFrame && nextFrame.actorId === frame.actorId && nextFrame.skillId === frame.skillId) {
          const skillMatchNext = String(nextFrame.message || "").match(/使出了\s*([^，,。！!—\s]+)/);
          if (skillMatchNext) extractedSkillName = skillMatchNext[1];
        }
      }
      if (extractedSkillName) {
        mainText = extractedSkillName;
        const rawRemaining = frame.message.replace(new RegExp(`\u4F7F\u51FA\u4E86\\s*${escapeRegExp(extractedSkillName)}[\uFF0C,\u3001\\s]*`), " ").trim();
        subText = stripCombatOutcomeText(rawRemaining, actor.name);
      } else {
        let rawSkillId = frame.skillId || "ULTIMATE_SKILL";
        if (rawSkillId.includes("_")) {
          rawSkillId = rawSkillId.substring(rawSkillId.indexOf("_") + 1);
        }
        mainText = rawSkillId.replace(/_/g, " ").toUpperCase();
        subText = stripCombatOutcomeText(frame.message, actor.name);
      }
    }
    const isEnglish = /[A-Za-z]/.test(mainText);
    const quoteEl = document.createElement("div");
    quoteEl.className = `ult-quote ${isEnglish ? "lang-en" : "lang-zh"}`;
    quoteEl.textContent = mainText;
    const flavorEl = document.createElement("div");
    flavorEl.className = "ult-flavor";
    flavorEl.textContent = subText;
    textWrapper.appendChild(quoteEl);
    if (subText) textWrapper.appendChild(flavorEl);
    overlay.appendChild(flash);
    overlay.appendChild(bgImg);
    overlay.appendChild(vignette);
    overlay.appendChild(textWrapper);
    arena.appendChild(overlay);
    arena.classList.remove("shake-active");
    void arena.offsetWidth;
    arena.classList.add("shake-active");
    const actualDuration = 2500 / getEffectiveSpeed();
    overlay.style.animationDuration = `${actualDuration}ms`;
    flash.style.animationDuration = `${actualDuration}ms`;
    bgImg.style.animationDuration = `${actualDuration}ms`;
    quoteEl.style.animationDuration = `${actualDuration}ms`;
    flavorEl.style.animationDuration = `${actualDuration}ms`;
    return new Promise((resolve) => {
      setTimeout(() => {
        if (overlay.isConnected) overlay.remove();
        resolve();
      }, actualDuration);
    });
  }
  function resolveDialogueSpeaker(frame) {
    if (!frame || !frame.message) return null;
    const msg = frame.message.trim();
    const disembodiedPattern = /不知道(?:從|由)?哪裡傳來|不知何處傳來|不知何方傳來|傳來(?:一個|一聲|陣陣|了)?.*聲音|耳邊響起|耳邊傳來|虛空中|空中傳來|四面八方傳來|四周傳來|遠處傳來|深處傳來|冥冥中|系統廣播|系統提示|^旁白[：:]/;
    if (disembodiedPattern.test(msg)) {
      return null;
    }
    const switchMatch = msg.match(/^[「『"“]Switch[！!]?[」』"”]\s*([^\s，,。]+)/i);
    if (switchMatch) {
      const candidateName = switchMatch[1].trim();
      if (frame.targetId) {
        const targetActor = engineState.actors.get(frame.targetId);
        if (targetActor && (candidateName.startsWith(targetActor.name) || targetActor.name.startsWith(candidateName))) {
          return { actorId: targetActor.id, quote: "Switch\uFF01" };
        }
      }
      for (const [id, actor] of engineState.actors.entries()) {
        if (candidateName.startsWith(actor.name) || actor.name.startsWith(candidateName)) {
          return { actorId: id, quote: "Switch\uFF01" };
        }
      }
      return null;
    }
    const colonQuoteMatch = msg.match(/^([^\n：:]{1,25})[：:]\s*[「『"“]([^」』"”]+)[」』"”]/);
    if (colonQuoteMatch) {
      const speakerPrefix = colonQuoteMatch[1].trim();
      const quote = `\u300C${colonQuoteMatch[2].trim()}\u300D`;
      if (disembodiedPattern.test(speakerPrefix)) {
        return null;
      }
      if (frame.actorId) {
        const frameActor = engineState.actors.get(frame.actorId);
        if (frameActor && (speakerPrefix.startsWith(frameActor.name) || speakerPrefix.includes(frameActor.name))) {
          return { actorId: frameActor.id, quote };
        }
      }
      for (const [id, actor] of engineState.actors.entries()) {
        if (speakerPrefix.startsWith(actor.name) || speakerPrefix.includes(actor.name)) {
          return { actorId: id, quote };
        }
      }
      return null;
    }
    const standaloneQuoteMatch = msg.match(/[「『"“]([^」』"”]+)[」』"”]/);
    if (standaloneQuoteMatch && (frame.type === "BOSS_DIALOGUE" || frame.type === "DIALOGUE")) {
      if (frame.actorId) {
        const frameActor = engineState.actors.get(frame.actorId);
        if (frameActor && msg.includes(frameActor.name) && !msg.startsWith("\u300CSwitch")) {
          return { actorId: frameActor.id, quote: `\u300C${standaloneQuoteMatch[1].trim()}\u300D` };
        }
      }
    }
    return null;
  }
  function renderSpeechBubble(frame, sr, token) {
    const speaker = resolveDialogueSpeaker(frame);
    if (!speaker) return 0;
    const actorEl = sr.getElementById(`actor-${speaker.actorId}`);
    const actor = engineState.actors.get(speaker.actorId);
    if (!actorEl || !actor) return 0;
    const existingBubble = actorEl.querySelector(".speech-bubble");
    if (existingBubble) existingBubble.remove();
    const bubble = document.createElement("div");
    bubble.className = `speech-bubble ${actor.side === "left" ? "left-bubble" : "right-bubble"}`;
    const textSpan = document.createElement("span");
    textSpan.className = "typewriter-text";
    bubble.appendChild(textSpan);
    actorEl.appendChild(bubble);
    const textContent = speaker.quote;
    const readTime = getMessageReadingDuration(textContent);
    let charIndex = 0;
    function typeChar() {
      if (engineState.playbackToken !== token || !bubble.isConnected) return;
      if (charIndex < textContent.length) {
        textSpan.textContent += textContent.charAt(charIndex);
        charIndex++;
        setTimeout(typeChar, 30 / getEffectiveSpeed());
      } else {
        textSpan.classList.remove("typewriter-text");
      }
    }
    typeChar();
    setTimeout(() => {
      if (bubble.isConnected) bubble.remove();
    }, (readTime + 500) / getEffectiveSpeed());
    return readTime;
  }
  function renderSceneNarrationBanner(frame, sr, token) {
    const arena = sr.getElementById("arena");
    if (!arena || !frame.message) return 0;
    const existingBanner = arena.querySelector(".scene-narration-banner");
    if (existingBanner) existingBanner.remove();
    const banner = document.createElement("div");
    banner.className = "scene-narration-banner";
    banner.innerHTML = escapeHtml(frame.message).replace(/\n/g, "<br>");
    arena.appendChild(banner);
    const speed = getEffectiveSpeed();
    const displayDuration = getMessageReadingDuration(frame.message);
    setTimeout(() => {
      if (banner.isConnected && engineState.playbackToken === token) {
        banner.classList.add("fade-out");
        setTimeout(() => {
          if (banner.isConnected) banner.remove();
        }, 400 / speed);
      }
    }, displayDuration / speed);
    return displayDuration;
  }
  function isSceneNarrationFrame(frame) {
    if (!frame || !frame.message) return false;
    if (frame.diceCheck || frame.isEnvironmentalPulse) return false;
    if (["DAMAGE", "BLOCK", "MISS", "HEAL", "LUCK_EVENT", "COUNTER"].includes(frame.type)) return false;
    if (frame.value != null && frame.value > 0) return false;
    const disembodiedPattern = /不知道(?:從|由)?哪裡傳來|不知何處傳來|不知何方傳來|傳來(?:一個|一聲|陣陣|了)?.*聲音|耳邊響起|耳邊傳來|虛空中|空中傳來|四面八方傳來|四周傳來|遠處傳來|深處傳來|冥冥中|系統廣播|系統提示|^旁白[：:]/;
    if (disembodiedPattern.test(frame.message)) return true;
    if (frame.type === "BOSS_DIALOGUE" || frame.type === "DIALOGUE") {
      return !resolveDialogueSpeaker(frame);
    }
    if (frame.type === "TEXT") {
      return frame.message.trim().length >= 15 || /風雪|斗篷|跪了|站了起來|每走一步|踩碎|咳出|結晶|軍刀|柴犬|敬禮|畢業/.test(frame.message);
    }
    return false;
  }
  function playEnvironmentalFieldPulse(frame, sr) {
    const arena = sr.getElementById("arena");
    if (!arena) return;
    const existingWave = arena.querySelector(".arena-field-wave");
    if (existingWave) existingWave.remove();
    const wave = document.createElement("div");
    wave.className = "arena-field-wave";
    arena.appendChild(wave);
    const speed = getEffectiveSpeed();
    engineState.actors.forEach((actor) => {
      const el = sr.getElementById(`actor-${actor.id}`);
      if (el && el.animate) {
        el.animate([
          { filter: "brightness(1)" },
          { filter: "brightness(1.4) drop-shadow(0 0 10px rgba(229, 62, 62, 0.75))", offset: 0.3 },
          { filter: "brightness(1)", offset: 1 }
        ], { duration: 550 / speed, easing: "ease-out" });
      }
    });
    setTimeout(() => {
      if (wave.isConnected) wave.remove();
    }, 950 / speed);
  }
  function spawnStatusOrDiceBadge(frame, sr) {
    const targetId = frame.targetId || frame.actorId;
    const actorEl = sr.getElementById(`actor-${targetId}`);
    if (!actorEl) return;
    const dc = frame.diceCheck;
    if (dc) {
      const badge = document.createElement("div");
      badge.className = "dice-badge";
      if (dc.kind === "threshold" && dc.dice) {
        const passed = !!dc.isSuccess;
        badge.classList.add(passed ? "dice-pass" : "dice-fail");
        badge.textContent = `\u{1F3B2} ${dc.dice.total} / DC ${dc.dc} (${passed ? "PASS" : "FAIL"})`;
      } else if (dc.kind === "opposed" && dc.left && dc.right) {
        const leftWon = dc.winner === "LEFT";
        badge.classList.add(leftWon ? "dice-pass" : "dice-fail");
        badge.textContent = `\u2696\uFE0F ${dc.left.total} vs ${dc.right.total}`;
      } else if (dc.kind === "roll" && dc.dice) {
        badge.classList.add("dice-roll");
        badge.textContent = `\u{1F3B2} \u6AA2\u5B9A ${dc.dice.total}`;
      } else {
        return;
      }
      actorEl.appendChild(badge);
      setTimeout(() => {
        if (badge.isConnected) badge.remove();
      }, 1400 / getEffectiveSpeed());
      return;
    }
    if (frame.type === "FATIGUE" || frame.type === "FATIGUE_SKIP" || frame.type === "SILENCED") {
      const badge = document.createElement("div");
      badge.className = "dice-badge dice-warn";
      if (frame.type === "SILENCED") {
        badge.textContent = "\u{1F910} \u9B54\u529B\u53D7\u9650";
      } else if (frame.type === "FATIGUE_SKIP" || frame.stage === "EXHAUSTED") {
        badge.textContent = "\u{1F975} \u529B\u7AED";
      } else {
        badge.textContent = "\u{1F4A6} \u75B2\u52DE";
      }
      actorEl.appendChild(badge);
      setTimeout(() => {
        if (badge.isConnected) badge.remove();
      }, 1200 / getEffectiveSpeed());
    }
    if (frame.contractEvent === "END") {
      const profile = getContractSkillProfile(frame.skillId);
      const actorOnlyEl = sr.getElementById(`actor-${frame.actorId}`);
      if (actorOnlyEl && profile) {
        const badge = document.createElement("div");
        badge.className = "dice-badge dice-warn";
        badge.textContent = profile.endBadgeText || "\u5951\u7D04\u7D50\u675F";
        actorOnlyEl.appendChild(badge);
        setTimeout(() => {
          if (badge.isConnected) badge.remove();
        }, 1200 / getEffectiveSpeed());
      }
      return;
    }
    for (const rule of SPECIAL_SKILL_BADGE_RULES) {
      if (matchesSkill(rule, frame.skillId) && frame.message) {
        const match = frame.message.match(rule.regex);
        if (match) {
          const badgeTargetId = rule.target === "actor" ? frame.actorId : frame.targetId || frame.actorId;
          const badgeTargetEl = sr.getElementById(`actor-${badgeTargetId}`);
          if (!badgeTargetEl) return;
          const badge = document.createElement("div");
          badge.className = `dice-badge ${rule.styleClass}`;
          badge.textContent = rule.text(match);
          badgeTargetEl.appendChild(badge);
          if (rule.shakeTarget) {
            badgeTargetEl.animate([
              { transform: "translateX(0)" },
              { transform: "translateX(-6px) rotate(-2deg)", offset: 0.25 },
              { transform: "translateX(6px) rotate(2deg)", offset: 0.5 },
              { transform: "translateX(-4px)", offset: 0.75 },
              { transform: "translateX(0)" }
            ], { duration: 360 / getEffectiveSpeed() });
          }
          setTimeout(() => {
            if (badge.isConnected) badge.remove();
          }, 1300 / getEffectiveSpeed());
          return;
        }
      }
    }
  }
  async function playContractCutIn(frame, sr, token) {
    const actor = engineState.actors.get(frame.actorId);
    const partner = frame.targetId ? engineState.actors.get(frame.targetId) : null;
    const profile = getContractSkillProfile(frame.skillId);
    if (!actor || !profile || engineState.playbackToken !== token) return;
    const arena = sr.getElementById("arena");
    if (!arena) return;
    const isDual = !!partner && partner.id !== actor.id;
    const baseDuration = frame.isContractRepeat ? 1050 : 1750;
    const actualDuration = baseDuration / getEffectiveSpeed();
    const overlay = document.createElement("div");
    overlay.className = `contract-cutin-overlay ${isDual ? "dual-mode" : "solo-mode"}`;
    overlay.style.setProperty("--contract-theme", profile.themeColor || "#f687b3");
    overlay.style.animationDuration = `${actualDuration}ms`;
    const safeActorName = escapeHtml(actor.name);
    const safeActorAvatar = escapeHtml(actor.avatar);
    const safePartnerName = partner ? escapeHtml(partner.name) : "";
    const safePartnerAvatar = partner ? escapeHtml(partner.avatar) : "";
    const safeBadgeIcon = escapeHtml(profile.badgeIcon);
    const safeBadgeText = escapeHtml(profile.badgeText);
    const safeSystemTitle = escapeHtml(profile.systemTitle);
    const safeSystemSubtitle = escapeHtml(profile.systemSubtitle);
    const portraitsHtml = isDual ? `
            <div class="contract-portrait left-partner">
                <img src="${safeActorAvatar}" onerror="this.src='${DEFAULT_AVATAR_URL}'">
                <div class="contract-partner-name">${safeActorName}</div>
            </div>
            <div class="contract-portrait right-partner">
                <img src="${safePartnerAvatar}" onerror="this.src='${DEFAULT_AVATAR_URL}'">
                <div class="contract-partner-name">${safePartnerName}</div>
            </div>
        ` : `
            <div class="contract-portrait solo-partner">
                <img src="${safeActorAvatar}" onerror="this.src='${DEFAULT_AVATAR_URL}'">
                <div class="contract-partner-name">${safeActorName}</div>
            </div>
        `;
    const headlineText = isDual ? `${safeActorName} <span>${safeBadgeIcon}</span> ${safePartnerName}` : `${safeActorName} <span>${safeBadgeIcon}</span> ${safeBadgeText}`;
    overlay.innerHTML = `
        <div class="contract-backdrop"></div>
        <div class="contract-portraits-layer contract-Portraits-layer">${portraitsHtml}</div>
        <div class="sao-modal-card">
            <div class="sao-modal-header">${safeSystemTitle}</div>
            <div class="sao-modal-body">
                <div class="sao-modal-couple">${headlineText}</div>
                <div class="sao-modal-desc">${safeSystemSubtitle}</div>
            </div>
            <div class="sao-modal-footer">
                <div class="sao-btn sao-btn-accept">\u25EF</div>
                <div class="sao-btn sao-btn-cancel">\u2715</div>
            </div>
        </div>
    `;
    arena.appendChild(overlay);
    const acceptBtn = overlay.querySelector(".sao-btn-accept");
    setTimeout(() => {
      if (acceptBtn && acceptBtn.isConnected) {
        acceptBtn.classList.add("pressed");
      }
    }, actualDuration * 0.38);
    return new Promise((resolve) => {
      setTimeout(() => {
        if (overlay.isConnected) overlay.remove();
        resolve();
      }, actualDuration);
    });
  }
  function spawnRosarioCross(frame, sr) {
    const targetId = frame.targetId || frame.actorId;
    if (!targetId) return;
    const targetEl = sr.getElementById(`actor-${targetId}`);
    if (!targetEl) return;
    const existing = targetEl.querySelector(".rosario-cross-mark");
    if (existing) existing.remove();
    const crossEl = document.createElement("div");
    crossEl.className = "rosario-cross-mark";
    const profile = getCrossFinisherProfile(frame.skillId);
    if (profile?.crossColor) crossEl.style.setProperty("--cross-color", profile.crossColor);
    if (profile?.glowColor) crossEl.style.setProperty("--glow-color", profile.glowColor);
    crossEl.innerHTML = `
        <div class="rosario-line line-1"></div>
        <div class="rosario-line line-2"></div>
        <div class="rosario-core"></div>
    `;
    targetEl.appendChild(crossEl);
    setTimeout(() => {
      if (crossEl.isConnected) crossEl.remove();
    }, 1800 / getEffectiveSpeed());
  }

  // src/combo.js
  function lookaheadComboState(currentIndex, frame) {
    let isNextFrameSameCombo = false;
    let isNextTargetDifferent = false;
    let shouldReturnToOrigin = false;
    const activeSkillId = frame.source === "DIRECT" && engineState.currentCombo.actorId === frame.actorId ? engineState.currentCombo.skillId : frame.skillId;
    for (let i = currentIndex + 1; i < engineState.frames.length; i++) {
      const lookahead = engineState.frames[i];
      if (lookahead.type === "LUCK_EVENT") {
        shouldReturnToOrigin = true;
        if (lookahead.turnNumber !== frame.turnNumber) break;
        continue;
      }
      if (lookahead.turnNumber !== frame.turnNumber) break;
      if (["HEAL", "SP_RECOVER", "BOSS_DIALOGUE", "SUMMON"].includes(lookahead.type)) {
        shouldReturnToOrigin = true;
        continue;
      }
      if (lookahead.type === "SKILL_TEXT") {
        const isSameSkillBridgeText = lookahead.actorId === frame.actorId && activeSkillId && lookahead.skillId === activeSkillId && !lookahead.isCoverEvent;
        if (!isSameSkillBridgeText) {
          shouldReturnToOrigin = true;
        }
        continue;
      }
      if (lookahead.type === "TEXT" && lookahead.skillTier === "ultimate") {
        shouldReturnToOrigin = true;
        continue;
      }
      if (lookahead.type === "BUFF_APPLY" && !lookahead.passiveId && lookahead.targetId === lookahead.actorId) {
        shouldReturnToOrigin = true;
        continue;
      }
      if (["DAMAGE", "MISS", "BLOCK", "COUNTER"].includes(lookahead.type)) {
        if (lookahead.isCounter || lookahead.type === "COUNTER") {
          const counteredAttackerId = lookahead.counterSource?.targetId || lookahead.targetId;
          if (counteredAttackerId && counteredAttackerId !== frame.actorId) {
            shouldReturnToOrigin = true;
            break;
          }
          continue;
        }
        if (lookahead.isSelfDamage || lookahead.isEnvironmentalPulse) {
          shouldReturnToOrigin = true;
          continue;
        }
        if (lookahead.actorId === frame.actorId) {
          isNextFrameSameCombo = true;
          if (lookahead.targetId !== frame.targetId) {
            isNextTargetDifferent = true;
          }
          const isDirectProc = lookahead.source === "DIRECT";
          if (!isDirectProc && lookahead.skillId !== activeSkillId) {
            shouldReturnToOrigin = true;
          }
        }
        break;
      }
    }
    return { isNextFrameSameCombo, isNextTargetDifferent, shouldReturnToOrigin };
  }
  function advanceComboState(frame, isNextFrameSameCombo) {
    if (frame.isCoverEvent) {
      engineState.currentCombo.heldForCoverActorId = null;
      engineState.currentCombo.knockedBack = true;
      engineState.currentCombo.keepAlive = false;
      return;
    }
    if (!frame.actorId || !["DAMAGE", "MISS", "COUNTER", "BLOCK"].includes(frame.type) || frame.isCounterSetup || frame.isSelfDamage || frame.isEnvironmentalPulse) {
      return;
    }
    if (frame.isCounter || frame.type === "COUNTER") {
      const counteredAttackerId = frame.counterSource?.targetId || frame.targetId;
      if (counteredAttackerId && engineState.currentCombo.actorId !== counteredAttackerId) {
        engineState.currentCombo.keepAlive = false;
        engineState.currentCombo.knockedBack = true;
      }
      return;
    }
    const displayDamage = frame.value || frame.actualDamage || 0;
    if (engineState.currentCombo.lastFrameIndex !== frame.index) {
      if (engineState.currentCombo.actorId === frame.actorId && engineState.currentCombo.keepAlive) {
        engineState.currentCombo.count++;
        engineState.currentCombo.totalDamage = (engineState.currentCombo.totalDamage || 0) + displayDamage;
        if (!engineState.currentCombo.targetDamages) engineState.currentCombo.targetDamages = {};
        engineState.currentCombo.targetDamages[frame.targetId] = (engineState.currentCombo.targetDamages[frame.targetId] || 0) + displayDamage;
        if (!engineState.currentCombo.targetHitCounts) engineState.currentCombo.targetHitCounts = {};
        engineState.currentCombo.targetHitCounts[frame.targetId] = (engineState.currentCombo.targetHitCounts[frame.targetId] || 0) + 1;
        if (engineState.currentCombo.targetId !== frame.targetId) {
          engineState.currentCombo.targetId = frame.targetId;
          engineState.currentCombo.moveX = void 0;
          engineState.currentCombo.deltaY = void 0;
          engineState.currentCombo.targetChangedThisHit = true;
        } else {
          engineState.currentCombo.targetChangedThisHit = false;
        }
      } else {
        engineState.currentCombo = {
          ...createEmptyCombo(),
          actorId: frame.actorId,
          skillId: frame.skillId,
          targetId: frame.targetId,
          count: 1,
          totalDamage: displayDamage,
          targetDamages: { [frame.targetId]: displayDamage },
          targetHitCounts: { [frame.targetId]: 1 },
          lastFrameIndex: frame.index
        };
      }
      engineState.currentCombo.lastFrameIndex = frame.index;
    }
    engineState.currentCombo.keepAlive = isNextFrameSameCombo;
  }
  function hasMoreHitsOnSameTargetInTurn(currentIndex, turnNumber, actorId, targetId) {
    for (let i = currentIndex + 1; i < engineState.frames.length; i++) {
      const lookahead = engineState.frames[i];
      if (lookahead.turnNumber !== turnNumber) break;
      if (lookahead.isCounter || lookahead.type === "COUNTER") continue;
      if (["DAMAGE", "MISS", "BLOCK"].includes(lookahead.type)) {
        return lookahead.actorId === actorId && lookahead.targetId === targetId;
      }
    }
    return false;
  }
  function renderComboBanner(arena, frame, speed) {
    if (engineState.currentCombo.count <= 1) return;
    const actor = engineState.actors.get(frame.actorId);
    const side = actor ? actor.side : "left";
    const existingCombo = arena.querySelector(`.global-combo-text-${side}`);
    if (existingCombo) existingCombo.remove();
    const comboEl = document.createElement("div");
    comboEl.className = `combo-text global-combo-text-${side}`;
    comboEl.innerHTML = `
        <div style="font-style: italic;">${engineState.currentCombo.count} HIT!</div>
        <div style="font-size: 36px; color: #ff6b6b; margin-top: -5px; text-shadow: 0 4px 10px rgba(0,0,0,0.8), 0 0 15px rgba(255, 107, 107, 0.8);">
            ${engineState.currentCombo.totalDamage} DMG
        </div>
    `;
    comboEl.style.cssText = `
        position: absolute; top: 10%; z-index: 60;
        color: #63b3ed; font-size: 64px; font-weight: 900; text-align: center;
        text-shadow: 0 4px 10px rgba(0,0,0,0.8), 0 0 15px rgba(99, 179, 237, 0.9);
        pointer-events: none;
        ${side === "left" ? "left: 5vw; right: auto;" : "right: 5vw; left: auto;"}
    `;
    arena.appendChild(comboEl);
    comboEl.animate([
      { transform: "scale(1.3) translateX(10px)", opacity: 0 },
      { transform: "scale(1) translateX(0)", opacity: 1 }
    ], { duration: 150 / speed, easing: "cubic-bezier(0.175, 0.885, 0.32, 1.275)" });
    setTimeout(() => {
      if (comboEl.isConnected) {
        const fade = comboEl.animate(
          [{ opacity: 1 }, { opacity: 0, transform: "translateY(-20px)" }],
          { duration: 300 / speed, fill: "forwards" }
        );
        fade.onfinish = () => comboEl.remove();
      }
    }, 1200 / speed);
  }

  // src/choreography.js
  function spawnClashSpark(arena, anchorEl, delay = 120, color = "#f6e05e", speed = 1) {
    setTimeout(() => {
      if (!anchorEl.isConnected || !arena.isConnected) return;
      const sparkEl = document.createElement("div");
      sparkEl.style.cssText = `position: absolute; width: 70px; height: 70px; background: radial-gradient(circle, #ffffff 20%, ${color} 50%, transparent 80%); border-radius: 50%; z-index: 20; transform: translate(-50%, -50%) scale(0); pointer-events: none; mix-blend-mode: screen; box-shadow: 0 0 20px ${color};`;
      const tRect = anchorEl.getBoundingClientRect();
      const aRect = arena.getBoundingClientRect();
      sparkEl.style.left = `${tRect.left - aRect.left + tRect.width / 2}px`;
      sparkEl.style.top = `${tRect.top - aRect.top + tRect.height / 2}px`;
      arena.appendChild(sparkEl);
      const sparkAnim = sparkEl.animate([
        { transform: "translate(-50%, -50%) scale(0) rotate(0deg)", opacity: 1 },
        { transform: "translate(-50%, -50%) scale(3) rotate(45deg)", opacity: 1, offset: 0.3 },
        { transform: "translate(-50%, -50%) scale(4.2) rotate(90deg)", opacity: 0, offset: 1 }
      ], { duration: 300 / speed });
      sparkAnim.onfinish = () => sparkEl.remove();
    }, delay / speed);
  }
  function spawnAOEFanWave(arena, startX, startY, targetSide, color = "#fc8181", speed = 1) {
    if (!arena || !arena.isConnected) return;
    const waveEl = document.createElement("div");
    const dirClass = targetSide === "right" ? "wave-right" : "wave-left";
    waveEl.className = `aoe-fan-wave ${dirClass}`;
    waveEl.style.setProperty("--wave-color", color);
    waveEl.style.left = `${startX}px`;
    waveEl.style.top = `${startY}px`;
    arena.appendChild(waveEl);
    const arenaRect = arena.getBoundingClientRect();
    const sweepDist = (targetSide === "right" ? 1 : -1) * Math.max(220, arenaRect.width * 0.34);
    const anim = waveEl.animate([
      { transform: "translate(-50%, -50%) scale(0.3, 0.45)", opacity: 0.95 },
      { transform: `translate(calc(-50% + ${sweepDist * 0.55}px), -50%) scale(1.25, 1.15)`, opacity: 1, offset: 0.45 },
      { transform: `translate(calc(-50% + ${sweepDist}px), -50%) scale(1.75, 1.45)`, opacity: 0, offset: 1 }
    ], {
      duration: 420 / speed,
      easing: "cubic-bezier(0.16, 1, 0.3, 1)"
    });
    anim.onfinish = () => waveEl.remove();
  }
  function spawnAOEProjectile(arena, startX, startY, targetEl, color = "#fc8181", delayMs = 0, flightMs = 150, speed = 1) {
    setTimeout(() => {
      if (!arena.isConnected || !targetEl || !targetEl.isConnected) return;
      const aRect = arena.getBoundingClientRect();
      const tRect = targetEl.getBoundingClientRect();
      const endX = tRect.left - aRect.left + tRect.width / 2;
      const endY = tRect.top - aRect.top + tRect.height / 2;
      const angleDeg = Math.atan2(endY - startY, endX - startX) * (180 / Math.PI);
      const projEl = document.createElement("div");
      projEl.className = "aoe-projectile";
      projEl.style.setProperty("--proj-color", color);
      projEl.style.left = "0px";
      projEl.style.top = "0px";
      arena.appendChild(projEl);
      const anim = projEl.animate([
        {
          transform: `translate(calc(${startX}px - 50%), calc(${startY}px - 50%)) rotate(${angleDeg}deg) scaleX(0.4)`,
          opacity: 0.9
        },
        {
          transform: `translate(calc(${(startX + endX) / 2}px - 50%), calc(${(startY + endY) / 2}px - 50%)) rotate(${angleDeg}deg) scaleX(1.35)`,
          opacity: 1,
          offset: 0.5
        },
        {
          transform: `translate(calc(${endX}px - 50%), calc(${endY}px - 50%)) rotate(${angleDeg}deg) scaleX(0.7)`,
          opacity: 0,
          offset: 1
        }
      ], {
        duration: flightMs / speed,
        easing: "cubic-bezier(0.2, 0.8, 0.4, 1)"
      });
      anim.onfinish = () => projEl.remove();
    }, delayMs / speed);
  }
  function triggerAOETargetImpact(frame, arena, targetEl, targetSide, shadowColor, speed) {
    if (!targetEl || !targetEl.isConnected) return;
    if (targetEl.getAnimations) targetEl.getAnimations().forEach((anim) => anim.cancel());
    const dodgeDir = targetSide === "left" ? -24 : 24;
    if (frame.type === "MISS") {
      targetEl.animate([
        { transform: "translate(0,0) scale(1)", filter: "blur(0px)" },
        { transform: `translate(${dodgeDir}px, 0) scale(0.88)`, filter: "blur(2px) brightness(1.5)", offset: 0.35 },
        { transform: "translate(0,0) scale(1)", filter: "blur(0px)", offset: 1 }
      ], { duration: 320 / speed, easing: "ease-out" });
    } else if (frame.type === "BLOCK" || frame.blocked) {
      targetEl.animate([
        { transform: "translate(0,0) scale(1)", filter: "brightness(1)" },
        { transform: `translate(${dodgeDir * 0.3}px, 2px) scale(0.96)`, filter: "brightness(1.4) drop-shadow(0 0 10px #63b3ed)", offset: 0.35 },
        { transform: "translate(0,0) scale(1)", filter: "brightness(1)", offset: 1 }
      ], { duration: 240 / speed, easing: "ease-out" });
      spawnClashSpark(arena, targetEl, 20, "#63b3ed", speed);
    } else {
      targetEl.animate([
        { transform: "translate(0,0) scale(1)", filter: "brightness(1)" },
        { transform: `translate(${dodgeDir * 0.55}px, 0) scale(0.92)`, filter: "brightness(1.85) contrast(1.3)", offset: 0.3 },
        { transform: "translate(0,0) scale(1)", filter: "brightness(1)", offset: 1 }
      ], { duration: 260 / speed, easing: "ease-out" });
      spawnClashSpark(arena, targetEl, 20, shadowColor, speed);
    }
  }
  function playAOEWaveBatchChoreography(waveFrames, sr) {
    const firstFrame = waveFrames[0];
    const lastFrame = waveFrames[waveFrames.length - 1];
    const speed = getEffectiveSpeed();
    const arena = sr.getElementById("arena");
    const casterId = firstFrame.aoeCasterId || firstFrame.actorId;
    const actorEl = sr.getElementById(`actor-${casterId}`);
    const side = engineState.actors.get(casterId)?.side || "left";
    const firstTargetSide = engineState.actors.get(firstFrame.targetId)?.side || (side === "left" ? "right" : "left");
    const shadowColor = side === "left" ? "#63b3ed" : "#fc8181";
    const staggerMs = 65;
    const impactDelayMs = 135;
    const waveSweepMs = impactDelayMs + Math.max(0, waveFrames.length - 1) * staggerMs + 280;
    if (!arena || !actorEl) {
      return { staggerMs, impactDelayMs, totalDurationMs: waveSweepMs, shadowColor };
    }
    if (actorEl.getAnimations) actorEl.getAnimations().forEach((anim) => anim.cancel());
    const arenaRect = arena.getBoundingClientRect();
    if (engineState.currentCombo.aoeCenterX === void 0 || firstFrame.isAOEFirst) {
      const cleanActorRect = actorEl.getBoundingClientRect();
      engineState.currentCombo.aoeCenterX = arenaRect.left + arenaRect.width / 2 - (cleanActorRect.left + cleanActorRect.width / 2);
      engineState.currentCombo.aoeCenterY = arenaRect.top + arenaRect.height / 2 - (cleanActorRect.top + cleanActorRect.height / 2);
    }
    const cMoveX = engineState.currentCombo.aoeCenterX || 0;
    const cDeltaY = engineState.currentCombo.aoeCenterY || 0;
    const p0 = "translate(0px, 0px) scale(1)";
    const pCenter = `translate(${cMoveX}px, ${cDeltaY}px) scale(1.22)`;
    const pCenterPulse = `translate(${cMoveX}px, ${cDeltaY}px) scale(1.32)`;
    const startTransform = engineState.currentCombo.atCenterStage ? pCenter : p0;
    if (lastFrame.isAOELast) {
      actorEl.animate([
        { transform: startTransform, zIndex: 10 },
        { transform: pCenterPulse, filter: `brightness(1.3) drop-shadow(0 0 18px ${shadowColor})`, zIndex: 10, offset: 0.22 },
        { transform: pCenter, filter: `drop-shadow(0 0 14px ${shadowColor})`, zIndex: 10, offset: 0.72 },
        { transform: p0, filter: "none", zIndex: 1, offset: 1 }
      ], {
        duration: waveSweepMs / speed,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "none"
      });
      engineState.currentCombo.atCenterStage = false;
      engineState.currentCombo.knockedBack = true;
    } else {
      actorEl.animate([
        { transform: startTransform, zIndex: 10 },
        { transform: pCenterPulse, filter: `brightness(1.3) drop-shadow(0 0 18px ${shadowColor})`, zIndex: 10, offset: 0.3 },
        { transform: pCenter, filter: `drop-shadow(0 0 14px ${shadowColor})`, zIndex: 10, offset: 1 }
      ], {
        duration: waveSweepMs / speed,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "forwards"
      });
      engineState.currentCombo.atCenterStage = true;
    }
    const centerStageX = arenaRect.width / 2;
    const centerStageY = arenaRect.height / 2;
    spawnAOEFanWave(arena, centerStageX, centerStageY, firstTargetSide, shadowColor, speed);
    waveFrames.forEach((wf, idx) => {
      const targetEl = wf.targetId ? sr.getElementById(`actor-${wf.targetId}`) : null;
      if (targetEl) {
        spawnAOEProjectile(arena, centerStageX, centerStageY, targetEl, shadowColor, idx * staggerMs, impactDelayMs, speed);
      }
    });
    return { staggerMs, impactDelayMs, totalDurationMs: waveSweepMs, shadowColor };
  }
  function playAOEWaveChoreography(frame, arena, actorEl, targetEl, side, targetSide, shadowColor, speed) {
    if (actorEl.getAnimations) actorEl.getAnimations().forEach((anim) => anim.cancel());
    if (targetEl.getAnimations) targetEl.getAnimations().forEach((anim) => anim.cancel());
    const arenaRect = arena.getBoundingClientRect();
    if (frame.isCounter || frame.type === "COUNTER") {
      const tRect = targetEl.getBoundingClientRect();
      const cMoveX2 = engineState.currentCombo.aoeCenterX ?? arenaRect.left + arenaRect.width / 2 - (tRect.left + tRect.width / 2);
      const cDeltaY2 = engineState.currentCombo.aoeCenterY ?? arenaRect.top + arenaRect.height / 2 - (tRect.top + tRect.height / 2);
      engineState.currentCombo.aoeCenterX = cMoveX2;
      engineState.currentCombo.aoeCenterY = cDeltaY2;
      const aRect = actorEl.getBoundingClientRect();
      const defToCenterX = arenaRect.left + arenaRect.width / 2 - (aRect.left + aRect.width / 2) + (side === "left" ? -45 : 45);
      const defToCenterY = arenaRect.top + arenaRect.height / 2 - (aRect.top + aRect.height / 2);
      const pCasterCenter = `translate(${cMoveX2}px, ${cDeltaY2}px) scale(1.2)`;
      const pCasterRecoil = `translate(${cMoveX2 + (targetSide === "left" ? -20 : 20)}px, ${cDeltaY2}px) scale(1.12)`;
      actorEl.animate([
        { transform: "translate(0,0) scale(1)", zIndex: 12 },
        { transform: `translate(${defToCenterX}px, ${defToCenterY}px) scale(1.15)`, filter: "brightness(1.5) drop-shadow(0 0 10px #fc8181)", zIndex: 12, offset: 0.25 },
        { transform: `translate(${defToCenterX}px, ${defToCenterY}px) scale(1.15)`, zIndex: 12, offset: 0.45 },
        { transform: "translate(0,0) scale(1)", zIndex: 1, offset: 1 }
      ], { duration: 480 / speed, easing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)", fill: "none" });
      if (frame.isAOELast) {
        targetEl.animate([
          { transform: pCasterCenter, zIndex: 10 },
          { transform: pCasterRecoil, zIndex: 10, offset: 0.3 },
          { transform: "translate(0,0) scale(1)", zIndex: 1, offset: 1 }
        ], { duration: 480 / speed, easing: "ease-out", fill: "none" });
        engineState.currentCombo.atCenterStage = false;
        engineState.currentCombo.knockedBack = true;
      } else {
        targetEl.animate([
          { transform: engineState.currentCombo.atCenterStage ? pCasterCenter : "translate(0,0) scale(1)", zIndex: 10 },
          { transform: pCasterRecoil, zIndex: 10, offset: 0.35 },
          { transform: pCasterCenter, zIndex: 10, offset: 1 }
        ], { duration: 480 / speed, easing: "ease-out", fill: "forwards" });
        engineState.currentCombo.atCenterStage = true;
      }
      spawnClashSpark(arena, targetEl, 80, "#f6e05e", speed);
      return 520;
    }
    if (engineState.currentCombo.aoeCenterX === void 0 || frame.isAOEFirst) {
      const cleanActorRect = actorEl.getBoundingClientRect();
      engineState.currentCombo.aoeCenterX = arenaRect.left + arenaRect.width / 2 - (cleanActorRect.left + cleanActorRect.width / 2);
      engineState.currentCombo.aoeCenterY = arenaRect.top + arenaRect.height / 2 - (cleanActorRect.top + cleanActorRect.height / 2);
    }
    const cMoveX = engineState.currentCombo.aoeCenterX;
    const cDeltaY = engineState.currentCombo.aoeCenterY;
    const p0 = "translate(0px, 0px) scale(1)";
    const pCenter = `translate(${cMoveX}px, ${cDeltaY}px) scale(1.2)`;
    const pCenterPulse = `translate(${cMoveX}px, ${cDeltaY}px) scale(1.28)`;
    let frameDuration;
    let actorKeyframes = [];
    const actorAnimConfig = { duration: 280 / speed, easing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)", fill: "none" };
    if (!engineState.currentCombo.atCenterStage && !frame.isAOELast) {
      frameDuration = 280;
      actorAnimConfig.duration = 260 / speed;
      actorAnimConfig.fill = "forwards";
      actorKeyframes = [
        { transform: p0, zIndex: 10 },
        { transform: pCenterPulse, filter: `drop-shadow(0 0 14px ${shadowColor})`, zIndex: 10, offset: 0.7 },
        { transform: pCenter, filter: `drop-shadow(0 0 10px ${shadowColor})`, zIndex: 10, offset: 1 }
      ];
      engineState.currentCombo.atCenterStage = true;
    } else if (engineState.currentCombo.atCenterStage && !frame.isAOELast) {
      frameDuration = 220;
      actorAnimConfig.duration = 200 / speed;
      actorAnimConfig.fill = "forwards";
      actorKeyframes = [
        { transform: pCenter, filter: `drop-shadow(0 0 10px ${shadowColor})`, zIndex: 10 },
        { transform: pCenterPulse, filter: `drop-shadow(0 0 16px ${shadowColor})`, zIndex: 10, offset: 0.45 },
        { transform: pCenter, filter: `drop-shadow(0 0 10px ${shadowColor})`, zIndex: 10, offset: 1 }
      ];
    } else {
      frameDuration = 400;
      actorAnimConfig.duration = 380 / speed;
      actorAnimConfig.fill = "none";
      const startTransform = engineState.currentCombo.atCenterStage ? pCenter : p0;
      actorKeyframes = [
        { transform: startTransform, zIndex: 10 },
        { transform: pCenterPulse, filter: `drop-shadow(0 0 16px ${shadowColor})`, zIndex: 10, offset: 0.35 },
        { transform: p0, filter: "none", zIndex: 1, offset: 1 }
      ];
      engineState.currentCombo.atCenterStage = false;
      engineState.currentCombo.knockedBack = true;
    }
    actorEl.animate(actorKeyframes, actorAnimConfig);
    const centerStageX = arenaRect.width / 2;
    const centerStageY = arenaRect.height / 2;
    if (frame.isAOEFirst) {
      spawnAOEFanWave(arena, centerStageX, centerStageY, targetSide, shadowColor, speed);
    }
    spawnAOEProjectile(arena, centerStageX, centerStageY, targetEl, shadowColor, 0, 120, speed);
    triggerAOETargetImpact(frame, arena, targetEl, targetSide, shadowColor, speed);
    return frameDuration;
  }
  function playSingleTargetChoreography(frame, arena, actorEl, targetEl, side, targetSide, shadowColor, speed, isNextFrameSameCombo, isNextTargetDifferent, shouldReturnToOrigin) {
    if (actorEl.getAnimations) actorEl.getAnimations().forEach((anim) => anim.cancel());
    if (targetEl.getAnimations) targetEl.getAnimations().forEach((anim) => anim.cancel());
    let frameDuration = 600;
    let moveX;
    let deltaY;
    if (engineState.currentCombo.count > 1 && engineState.currentCombo.moveX !== void 0 && !frame.isCounter && frame.type !== "COUNTER") {
      moveX = engineState.currentCombo.moveX;
      deltaY = engineState.currentCombo.deltaY;
    } else {
      const actorRect = actorEl.getBoundingClientRect();
      const targetRect = targetEl.getBoundingClientRect();
      moveX = targetRect.left - actorRect.left + (side === "left" ? -60 : 60);
      deltaY = targetRect.top - actorRect.top;
      if (!frame.isCounter && frame.type !== "COUNTER") {
        engineState.currentCombo.moveX = moveX;
        engineState.currentCombo.deltaY = deltaY;
      }
    }
    const isCombo = engineState.currentCombo.count > 1 || isNextFrameSameCombo;
    const startsFromOrigin = engineState.currentCombo.count === 1 || !isCombo || engineState.currentCombo.knockedBack || engineState.currentCombo.targetChangedThisHit;
    if (!frame.isCounter && frame.type !== "COUNTER") {
      engineState.currentCombo.knockedBack = false;
    }
    const isFollowedByCover = !!frame.holdPositionForCover;
    const stayAtTarget = isNextFrameSameCombo && !isNextTargetDifferent && !shouldReturnToOrigin || isFollowedByCover;
    if (isFollowedByCover) {
      engineState.currentCombo.heldForCoverActorId = frame.actorId;
    } else if ((shouldReturnToOrigin || isNextTargetDifferent) && !frame.isCounter && frame.type !== "COUNTER") {
      engineState.currentCombo.knockedBack = true;
    }
    const isFirstHit = startsFromOrigin && stayAtTarget;
    const isMiddleHit = !startsFromOrigin && stayAtTarget;
    const p0 = "translate(0px, 0px) scale(1)";
    const pTarget = `translate(${moveX}px, ${deltaY}px) scale(1.15)`;
    const pStart = startsFromOrigin ? p0 : pTarget;
    let actorKeyframes = [];
    let targetKeyframes = [];
    const actorAnimConfig = { duration: 400 / speed, easing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)", fill: "none" };
    const targetAnimConfig = { duration: 400 / speed, easing: "ease-out", fill: "none" };
    if (frame.isCounter || frame.type === "COUNTER") {
      frameDuration = 600;
      actorAnimConfig.duration = 500 / speed;
      targetAnimConfig.duration = 500 / speed;
      const originalAttackerId = frame.targetId;
      const isMiddleHitCounter = engineState.currentCombo.actorId === originalAttackerId && engineState.currentCombo.count > 1;
      const attackerContinuesOnSameTarget = hasMoreHitsOnSameTargetInTurn(
        engineState.currentFrameIndex,
        frame.turnNumber,
        originalAttackerId,
        frame.actorId
      );
      const actorRect = actorEl.getBoundingClientRect();
      const targetRect = targetEl.getBoundingClientRect();
      const attackerToDefenderX = actorRect.left - targetRect.left + (targetSide === "left" ? -60 : 60);
      const attackerToDefenderY = actorRect.top - targetRect.top;
      const pAttackerClash = `translate(${attackerToDefenderX}px, ${attackerToDefenderY}px) scale(1.15)`;
      const pAttackerPushback = `translate(${attackerToDefenderX * 0.2}px, ${attackerToDefenderY * 0.2}px) scale(1.1)`;
      const counterDashX = side === "left" ? 20 : -20;
      actorKeyframes = [
        { transform: "translate(0,0) scale(1)", filter: "brightness(1)", zIndex: 11 },
        { transform: `translate(${counterDashX}px, 0) scale(1.05)`, filter: "brightness(1.5) drop-shadow(0 0 10px #fc8181)", zIndex: 11, offset: 0.15 },
        { transform: `translate(${counterDashX}px, 0) scale(1.05)`, filter: "brightness(1.5) drop-shadow(0 0 10px #fc8181)", zIndex: 11, offset: 0.4 },
        { transform: "translate(0,0) scale(1)", filter: "brightness(1)", zIndex: 1, offset: 1 }
      ];
      if (!isMiddleHitCounter || !attackerContinuesOnSameTarget) {
        targetKeyframes = [
          { transform: isMiddleHitCounter ? pAttackerClash : "translate(0,0) scale(1)", zIndex: 10 },
          { transform: pAttackerClash, zIndex: 10, offset: 0.15 },
          { transform: pAttackerClash, zIndex: 10, offset: 0.2 },
          { transform: "translate(0,0) scale(1)", zIndex: 1, offset: 1 }
        ];
        engineState.currentCombo.knockedBack = true;
      } else {
        targetKeyframes = [
          { transform: pAttackerClash, zIndex: 10 },
          { transform: pAttackerClash, zIndex: 10, offset: 0.15 },
          { transform: pAttackerPushback, zIndex: 10, offset: 0.5 },
          { transform: pAttackerClash, zIndex: 10, offset: 1 }
        ];
        targetAnimConfig.fill = "forwards";
      }
      spawnClashSpark(arena, targetEl, 60, "#f6e05e", speed);
    } else if (frame.type === "BLOCK" || frame.blocked) {
      const recoilOffset = side === "left" ? -18 : 18;
      targetKeyframes = [
        { transform: "translate(0,0) scale(1)", filter: "brightness(1)" },
        { transform: `translate(${side === "left" ? 4 : -4}px, 2px) scale(0.97)`, filter: "brightness(1.4) drop-shadow(0 0 10px #63b3ed)", offset: 0.35 },
        { transform: "translate(0,0) scale(1)", filter: "brightness(1)", offset: 1 }
      ];
      if (isFirstHit) {
        frameDuration = 280;
        actorAnimConfig.duration = 260 / speed;
        targetAnimConfig.duration = 260 / speed;
        actorKeyframes = [
          { transform: p0, zIndex: 10 },
          { transform: pTarget, zIndex: 10, offset: 0.6 },
          { transform: `translate(${moveX + recoilOffset}px, ${deltaY}px) scale(1.1)`, zIndex: 10, offset: 0.85 },
          { transform: pTarget, zIndex: 10, offset: 1 }
        ];
        actorAnimConfig.fill = "forwards";
        spawnClashSpark(arena, targetEl, 80, "#63b3ed", speed);
      } else if (isMiddleHit) {
        frameDuration = 210;
        actorAnimConfig.duration = 190 / speed;
        targetAnimConfig.duration = 190 / speed;
        actorKeyframes = [
          { transform: pTarget, zIndex: 10 },
          { transform: `translate(${moveX + recoilOffset}px, ${deltaY + (Math.random() * 12 - 6)}px) scale(1.08)`, zIndex: 10, offset: 0.45 },
          { transform: pTarget, zIndex: 10, offset: 1 }
        ];
        actorAnimConfig.fill = "forwards";
        spawnClashSpark(arena, targetEl, 40, "#63b3ed", speed);
      } else {
        frameDuration = 420;
        actorAnimConfig.duration = 380 / speed;
        targetAnimConfig.duration = 350 / speed;
        actorKeyframes = [
          { transform: pStart, zIndex: 10 },
          { transform: pTarget, zIndex: 10, offset: 0.35 },
          { transform: `translate(${moveX + recoilOffset * 1.5}px, ${deltaY}px) scale(1.05)`, zIndex: 10, offset: 0.55 },
          { transform: p0, zIndex: 1, offset: 1 }
        ];
        spawnClashSpark(arena, targetEl, 70, "#63b3ed", speed);
      }
    } else if (frame.type === "MISS") {
      const isStandaloneFirstMiss = engineState.currentCombo.count === 1 && !isNextFrameSameCombo && !isNextTargetDifferent;
      if (isStandaloneFirstMiss) {
        frameDuration = 850;
        actorAnimConfig.duration = 800 / speed;
        targetAnimConfig.duration = 500 / speed;
        const dashOutX = moveX * 4;
        const reappearX = moveX * -1.5;
        actorKeyframes = [
          { transform: p0, zIndex: 10, offset: 0 },
          { transform: `translate(${dashOutX}px, ${deltaY}px) scale(1.15)`, zIndex: 10, offset: 0.3 },
          { transform: `translate(${reappearX}px, 0px) scale(1)`, zIndex: 1, offset: 0.31 },
          { transform: p0, zIndex: 1, offset: 1 }
        ];
        actorAnimConfig.fill = "none";
        targetKeyframes = [
          { transform: "scale(1)", filter: "blur(0px)" },
          { transform: "scale(0.8)", filter: "blur(3px) brightness(1.5)", offset: 0.3 },
          { transform: "scale(1)", filter: "blur(0px)", offset: 1 }
        ];
        engineState.currentCombo.knockedBack = true;
      } else {
        frameDuration = 420;
        actorAnimConfig.duration = 380 / speed;
        targetAnimConfig.duration = 380 / speed;
        const missReachMultiplier = isNextTargetDifferent ? 1 : 1.35;
        if (isFirstHit) {
          actorKeyframes = [
            { transform: p0, zIndex: 1 },
            { transform: `translate(${moveX * missReachMultiplier}px, ${deltaY}px) scale(1.15)`, zIndex: 10, offset: 0.5 },
            { transform: pTarget, zIndex: 10, offset: 1 }
          ];
          actorAnimConfig.fill = "forwards";
          targetKeyframes = [
            { transform: "scale(1)", filter: "blur(0px)" },
            { transform: "scale(0.8)", filter: "blur(3px) brightness(1.5)", offset: 0.4 },
            { transform: "scale(1)", filter: "blur(0px)", offset: 1 }
          ];
        } else if (isMiddleHit) {
          actorKeyframes = [
            { transform: pStart, zIndex: 10 },
            { transform: `translate(${moveX * missReachMultiplier}px, ${deltaY}px) scale(1.15)`, zIndex: 10, offset: 0.5 },
            { transform: pTarget, zIndex: 10, offset: 1 }
          ];
          actorAnimConfig.fill = "forwards";
          targetKeyframes = [
            { transform: "scale(1)", filter: "blur(0px)" },
            { transform: "scale(0.85)", filter: "blur(4px) brightness(1.8)", offset: 0.5 },
            { transform: "scale(1)", filter: "blur(0px)", offset: 1 }
          ];
        } else {
          actorKeyframes = [
            { transform: pStart, zIndex: 10 },
            { transform: `translate(${moveX * missReachMultiplier}px, ${deltaY}px) scale(1.15)`, zIndex: 10, offset: 0.4 },
            { transform: p0, zIndex: 1, offset: 1 }
          ];
          targetKeyframes = [
            { transform: "scale(1)", filter: "blur(0px)" },
            { transform: "scale(0.8)", filter: "blur(3px)", offset: 0.4 },
            { transform: "scale(1)", filter: "blur(0px)", offset: 1 }
          ];
        }
      }
    } else {
      if (isFirstHit) {
        actorKeyframes = [
          { transform: p0, zIndex: 1 },
          { transform: `translate(${side === "left" ? -20 : 20}px, 0) scale(0.95)`, zIndex: 1, offset: 0.15 },
          { transform: pTarget, zIndex: 10, offset: 0.8 },
          { transform: pTarget, zIndex: 10, offset: 1 }
        ];
        actorAnimConfig.fill = "forwards";
        actorAnimConfig.duration = 250 / speed;
        frameDuration = 250;
      } else if (isMiddleHit) {
        const vibX = moveX + (Math.random() * 20 - 10);
        const vibY = deltaY + (Math.random() * 20 - 10);
        actorKeyframes = [
          { transform: pStart, zIndex: 10 },
          { transform: `translate(${vibX}px, ${vibY}px) scale(1.25)`, zIndex: 10, filter: `drop-shadow(0 0 12px ${shadowColor})`, offset: 0.5 },
          { transform: pTarget, zIndex: 10, offset: 1 }
        ];
        actorAnimConfig.fill = "forwards";
        actorAnimConfig.duration = 150 / speed;
        frameDuration = 180;
        if (targetEl) {
          targetEl.style.filter = "brightness(2) contrast(1.5)";
          targetEl.style.transform = `translateX(${side === "left" ? 10 : -10}px)`;
          setTimeout(() => {
            if (targetEl.isConnected) {
              targetEl.style.filter = "";
              targetEl.style.transform = "";
            }
          }, 80 / speed);
        }
      } else {
        actorKeyframes = [
          { transform: pStart, zIndex: 10 },
          { transform: pTarget, zIndex: 10, offset: 0.4 },
          { transform: p0, zIndex: 1, offset: 1 }
        ];
        actorAnimConfig.duration = 400 / speed;
        frameDuration = 450;
      }
    }
    const choreoProfile = getSkillChoreographyProfile(frame.skillId);
    if (choreoProfile?.targetReaction === "RAPID_SHAKE" && frame.type === "DAMAGE") {
      targetKeyframes = [
        { transform: "translate(0, 0) rotate(0deg)", filter: "brightness(1)" },
        { transform: "translate(-12px, -4px) rotate(-6deg)", filter: "brightness(1.6)", offset: 0.2 },
        { transform: "translate(10px, 2px) rotate(5deg)", offset: 0.4 },
        { transform: "translate(-10px, -2px) rotate(-5deg)", offset: 0.6 },
        { transform: "translate(8px, 0) rotate(3deg)", offset: 0.8 },
        { transform: "translate(0, 0) rotate(0deg)", filter: "brightness(1)", offset: 1 }
      ];
      targetAnimConfig.duration = (choreoProfile.shakeDuration || 420) / speed;
    }
    if (choreoProfile?.glowColor && frame.type === "DAMAGE") {
      if (choreoProfile.sparkColor) {
        spawnClashSpark(arena, targetEl, choreoProfile.sparkSize || 55, choreoProfile.sparkColor, speed);
      }
      actorKeyframes = actorKeyframes.map((kf, idx) => {
        if (idx > 0 && idx < actorKeyframes.length - 1) {
          return {
            ...kf,
            filter: `brightness(1.45) drop-shadow(0 0 16px ${choreoProfile.glowColor})`
          };
        }
        return kf;
      });
    }
    if (frame.rosarioEvent === "PIERCE_CROSS") {
      const crossProfile = getCrossFinisherProfile(frame.skillId) || {};
      const primaryColor = crossProfile.crossColor || "#f687b3";
      const secondaryColor = crossProfile.glowColor || "#b794f4";
      spawnClashSpark(arena, targetEl, 60, primaryColor, speed);
      spawnClashSpark(arena, targetEl, 140, secondaryColor, speed);
      const crossEl = targetEl.querySelector(".rosario-cross-mark");
      if (crossEl) {
        crossEl.classList.add("shatter");
        setTimeout(() => {
          if (crossEl.isConnected) crossEl.remove();
        }, 450 / speed);
      }
    } else if (frame.isCounter || frame.type === "COUNTER") {
      const defenderCrossEl = actorEl.querySelector(".rosario-cross-mark");
      if (defenderCrossEl) {
        defenderCrossEl.classList.add("shatter");
        setTimeout(() => {
          if (defenderCrossEl.isConnected) defenderCrossEl.remove();
        }, 450 / speed);
      }
    }
    actorEl.animate(actorKeyframes, actorAnimConfig);
    if (targetKeyframes.length > 0) {
      targetEl.animate(targetKeyframes, targetAnimConfig);
    }
    return frameDuration;
  }
  function playCombatAnimation(frame, sr, isNextFrameSameCombo, isNextTargetDifferent, shouldReturnToOrigin) {
    if (frame.isCounterSetup) {
      return 350;
    }
    let frameDuration = 600;
    const arena = sr.getElementById("arena");
    if (!arena) return frameDuration;
    const speed = getEffectiveSpeed();
    if (frame.isSelfDamage || frame.isEnvironmentalPulse) {
      const targetEl2 = sr.getElementById(`actor-${frame.targetId}`);
      if (targetEl2) {
        targetEl2.animate([
          { transform: "translate(0, 0) scale(1)", filter: "brightness(1)" },
          { transform: "translate(0, 6px) scale(0.95)", filter: "brightness(1.8) sepia(0.8) hue-rotate(-50deg)", offset: 0.3 },
          { transform: "translate(0, 0) scale(1)", filter: "brightness(1)", offset: 1 }
        ], { duration: 350 / speed, easing: "ease-out" });
      }
      return 420;
    }
    advanceComboState(frame, isNextFrameSameCombo);
    if (!frame.isCounter && frame.type !== "COUNTER") {
      renderComboBanner(arena, frame, speed);
    }
    const actorEl = sr.getElementById(`actor-${frame.actorId}`);
    const targetEl = frame.targetId ? sr.getElementById(`actor-${frame.targetId}`) : null;
    if (actorEl && targetEl) {
      const side = engineState.actors.get(frame.actorId)?.side || "left";
      const targetSide = engineState.actors.get(frame.targetId)?.side || "right";
      const shadowColor = side === "left" ? "#fc8181" : "#4fd1c5";
      if (frame.isAOE) {
        return playAOEWaveChoreography(frame, arena, actorEl, targetEl, side, targetSide, shadowColor, speed);
      }
      return playSingleTargetChoreography(
        frame,
        arena,
        actorEl,
        targetEl,
        side,
        targetSide,
        shadowColor,
        speed,
        isNextFrameSameCombo,
        isNextTargetDifferent,
        shouldReturnToOrigin
      );
    }
    return frameDuration;
  }
  function playCoverAnimation(frame, sr) {
    const speed = getEffectiveSpeed();
    const arena = sr.getElementById("arena");
    const actorEl = sr.getElementById(`actor-${frame.actorId}`);
    const targetEl = frame.targetId ? sr.getElementById(`actor-${frame.targetId}`) : null;
    const attackerEl = frame.coverAttackerId ? sr.getElementById(`actor-${frame.coverAttackerId}`) : null;
    if (!actorEl || !targetEl || actorEl === targetEl) return 500;
    const wasHeldAtTarget = !!frame.coverAttackerId && engineState.currentCombo.heldForCoverActorId === frame.coverAttackerId;
    advanceComboState(frame, false);
    if (actorEl.getAnimations) actorEl.getAnimations().forEach((anim) => anim.cancel());
    if (targetEl.getAnimations) targetEl.getAnimations().forEach((anim) => anim.cancel());
    if (attackerEl && attackerEl.getAnimations) {
      attackerEl.getAnimations().forEach((anim) => anim.cancel());
    }
    const side = engineState.actors.get(frame.actorId)?.side || "left";
    const actorRect = actorEl.getBoundingClientRect();
    const targetRect = targetEl.getBoundingClientRect();
    const frontOffsetX = side === "left" ? 44 : -44;
    const moveX = targetRect.left - actorRect.left + frontOffsetX;
    const deltaY = targetRect.top - actorRect.top;
    const shieldRing = document.createElement("div");
    shieldRing.className = "bridal-cover-shield";
    shieldRing.innerHTML = "<span>\u{1F48D} GUARD</span>";
    actorEl.appendChild(shieldRing);
    if (frame.coverDamage > 0) {
      const dmgEl = document.createElement("div");
      dmgEl.className = "floating-text";
      dmgEl.style.color = "#fbb6ce";
      dmgEl.textContent = `-${frame.coverDamage}`;
      actorEl.appendChild(dmgEl);
      setTimeout(() => {
        if (dmgEl.isConnected) dmgEl.remove();
      }, 850 / speed);
    }
    if (attackerEl) {
      const attackerSide = engineState.actors.get(frame.coverAttackerId)?.side || (side === "left" ? "right" : "left");
      const attackerRect = attackerEl.getBoundingClientRect();
      const enemyHeldX = targetRect.left - attackerRect.left + (attackerSide === "left" ? -60 : 60);
      const enemyHeldY = targetRect.top - attackerRect.top;
      const enemyClashX = targetRect.left - attackerRect.left + (attackerSide === "left" ? -78 : 78);
      const enemyRecoilX = enemyClashX + (attackerSide === "left" ? -28 : 28);
      const pEnemyStart = wasHeldAtTarget ? `translate(${enemyHeldX}px, ${enemyHeldY}px) scale(1.15)` : "translate(0, 0) scale(1)";
      attackerEl.animate([
        { transform: pEnemyStart, zIndex: 14 },
        {
          transform: `translate(${enemyClashX}px, ${enemyHeldY}px) scale(1.22)`,
          filter: "brightness(1.45)",
          zIndex: 14,
          offset: 0.25
        },
        {
          transform: `translate(${enemyRecoilX}px, ${enemyHeldY}px) scale(1.06)`,
          filter: "brightness(1.8) drop-shadow(0 0 12px #f687b3)",
          zIndex: 14,
          offset: 0.45
        },
        { transform: "translate(0, 0) scale(1)", filter: "none", zIndex: 1, offset: 1 }
      ], {
        duration: 640 / speed,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)"
      });
      if (arena) {
        setTimeout(() => {
          if (!actorEl.isConnected || !arena.isConnected) return;
          const sparkEl = document.createElement("div");
          sparkEl.style.cssText = "position: absolute; width: 80px; height: 80px; background: radial-gradient(circle, #ffffff 25%, #f687b3 55%, transparent 80%); border-radius: 50%; z-index: 25; transform: translate(-50%, -50%) scale(0); pointer-events: none; mix-blend-mode: screen; box-shadow: 0 0 24px #f687b3;";
          const aRect = actorEl.getBoundingClientRect();
          const arRect = arena.getBoundingClientRect();
          const sparkOffsetX = side === "left" ? aRect.width * 0.85 : aRect.width * 0.15;
          sparkEl.style.left = `${aRect.left - arRect.left + sparkOffsetX}px`;
          sparkEl.style.top = `${aRect.top - arRect.top + aRect.height / 2}px`;
          arena.appendChild(sparkEl);
          const sparkAnim = sparkEl.animate([
            { transform: "translate(-50%, -50%) scale(0) rotate(0deg)", opacity: 1 },
            { transform: "translate(-50%, -50%) scale(3.2) rotate(45deg)", opacity: 1, offset: 0.3 },
            { transform: "translate(-50%, -50%) scale(4.5) rotate(90deg)", opacity: 0, offset: 1 }
          ], { duration: 320 / speed });
          sparkAnim.onfinish = () => sparkEl.remove();
        }, 140 / speed);
      }
    }
    actorEl.animate([
      { transform: "translate(0, 0) scale(1)", zIndex: 15 },
      {
        transform: `translate(${moveX}px, ${deltaY}px) scale(1.14)`,
        filter: "brightness(1.35) drop-shadow(0 0 14px #f687b3)",
        zIndex: 15,
        offset: 0.23
      },
      {
        transform: `translate(${moveX - (side === "left" ? 12 : -12)}px, ${deltaY}px) scale(1.08)`,
        filter: "brightness(1.6) drop-shadow(0 0 22px #fbb6ce)",
        zIndex: 15,
        offset: 0.52
      },
      { transform: "translate(0, 0) scale(1)", filter: "none", zIndex: 1, offset: 1 }
    ], {
      duration: 640 / speed,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)"
    });
    targetEl.animate([
      { transform: "translate(0, 0) scale(1)" },
      { transform: `translate(${side === "left" ? -14 : 14}px, 0) scale(0.95)`, offset: 0.3 },
      { transform: `translate(${side === "left" ? -14 : 14}px, 0) scale(0.95)`, offset: 0.55 },
      { transform: "translate(0, 0) scale(1)", offset: 1 }
    ], {
      duration: 580 / speed,
      easing: "ease-out"
    });
    setTimeout(() => {
      if (shieldRing.isConnected) shieldRing.remove();
    }, 620 / speed);
    return 660;
  }

  // src/floatingText.js
  function spawnFloatingText(frame, sr, isNextFrameSameCombo, isNextTargetDifferent) {
    if (frame.isCounterSetup || frame.type === "HP_REMAINING" || frame.type === "EXP_GAIN") return;
    const arena = sr.getElementById("arena");
    if (!arena) return;
    if (frame.type === "LUCK_EVENT" || frame.vfx.includes("break-stamp")) {
      engineState.actors.forEach((actor) => {
        const el = sr.getElementById(`actor-${actor.id}`);
        if (el && el.getAnimations) {
          el.getAnimations().forEach((anim) => anim.cancel());
        }
      });
      if (engineState.currentCombo) {
        engineState.currentCombo.knockedBack = true;
        engineState.currentCombo.atCenterStage = false;
      }
    }
    const affectedId = frame.targetId || frame.actorId;
    if (!affectedId) return;
    const affectedEl = sr.getElementById(`actor-${affectedId}`);
    const targetActor = engineState.actors.get(affectedId);
    const displayValue = frame.value != null ? frame.value : frame.actualDamage;
    const isActionOrEffectFrame = [
      "DAMAGE",
      "BLOCK",
      "COUNTER",
      "MISS",
      "HEAL",
      "SP_RECOVER",
      "BUFF_EFFECT",
      "LUCK_EVENT"
    ].includes(frame.type) || frame.rebirthHeal;
    if (!isActionOrEffectFrame || !affectedEl || frame.vfx.includes("break-stamp")) {
      return;
    }
    const targetHitCount = engineState.currentCombo.targetHitCounts?.[frame.targetId] || 1;
    const isTargetCombo = ["DAMAGE", "BLOCK"].includes(frame.type) && !frame.isCounter && !frame.isSelfDamage && !frame.isEnvironmentalPulse && targetHitCount > 1;
    const isBigHit = targetActor && !targetActor.hideHp && displayValue >= targetActor.maxHp * 0.15;
    const isCriticalOrBig = frame.isCrit && !frame.blocked || isBigHit;
    const arenaRect = arena.getBoundingClientRect();
    const actorRect = affectedEl.getBoundingClientRect();
    const centerX = actorRect.left - arenaRect.left + actorRect.width / 2;
    const centerY = actorRect.top - arenaRect.top + actorRect.height / 2;
    const now = performance.now();
    let actorFloats = engineState.floatTracker.get(affectedId) || [];
    actorFloats = actorFloats.filter((f) => now < f.expiresAt);
    let finalX = centerX;
    let finalY = centerY - 20;
    if (isTargetCombo && displayValue > 0) {
      const comboAvoidOffset = targetActor && targetActor.side === "left" ? 60 : -60;
      finalX += comboAvoidOffset;
      finalY -= 30;
    }
    if (isTargetCombo || isCriticalOrBig || frame.type === "BUFF_EFFECT" || frame.isBeneficial || frame.blocked) {
      let attempts = 0;
      let overlap = true;
      const pushRadius = 45;
      finalX += (Math.random() - 0.5) * 70;
      finalY -= Math.random() * 40;
      while (overlap && attempts < 15) {
        overlap = false;
        for (const active of actorFloats) {
          const dx = finalX - active.x;
          const dy = finalY - active.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < pushRadius) {
            overlap = true;
            const angle = dx === 0 && dy === 0 ? Math.random() * Math.PI * 2 : Math.atan2(dy, dx);
            finalX += Math.cos(angle) * 20;
            finalY += Math.sin(angle) * 20 - 15;
            break;
          }
        }
        attempts++;
      }
    }
    let hitDuration = 900;
    let hitScale = isTargetCombo ? 0.75 : 1;
    if (isCriticalOrBig) {
      hitDuration = 1800;
      hitScale = 1.5;
    }
    actorFloats.push({ x: finalX, y: finalY, expiresAt: now + hitDuration / getEffectiveSpeed() });
    engineState.floatTracker.set(affectedId, actorFloats);
    const floatEl = document.createElement("div");
    floatEl.className = "floating-text";
    floatEl.style.animation = "none";
    floatEl.style.top = "0px";
    floatEl.style.left = "0px";
    if (frame.type === "MISS") {
      floatEl.style.color = "#a0aec0";
      floatEl.textContent = "MISS";
    } else if (frame.vfx.includes("shield-block") || frame.type === "BLOCK" || frame.blocked) {
      floatEl.classList.add("floating-block");
      floatEl.textContent = displayValue > 0 ? `\u{1F6E1}\uFE0F BLOCK -${displayValue}` : "\u{1F6E1}\uFE0F BLOCK";
    } else if (displayValue === 0 && !frame.isBeneficial) {
      floatEl.style.color = "#a0aec0";
      floatEl.textContent = "Immune";
    } else {
      const prefix = frame.isBeneficial ? "+" : "-";
      const targetVal = displayValue;
      if (frame.vfx.includes("flash-green")) {
        floatEl.classList.add("floating-heal");
        floatEl.style.color = "#48bb78";
        floatEl.style.textShadow = "0 0 10px rgba(72, 187, 120, 0.8)";
      } else if (frame.vfx.includes("flash-blue")) {
        floatEl.style.color = "#90cdf4";
        floatEl.style.textShadow = "0 0 10px rgba(99, 179, 237, 0.8)";
      } else if (frame.type === "LUCK_EVENT" || frame.vfx.includes("flash-purple")) {
        floatEl.style.color = "#b794f4";
        floatEl.style.textShadow = "0 0 10px rgba(183, 148, 244, 0.8)";
      } else if (frame.isCrit) {
        floatEl.style.color = "#f6ad55";
        floatEl.style.textShadow = "0 0 10px rgba(221, 107, 32, 1)";
        floatEl.style.fontSize = "32px";
        floatEl.style.fontStyle = "italic";
      }
      const countDuration = 200;
      const startTime = performance.now();
      const updateSingleCounter = (currentTime) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / countDuration, 1);
        const easeOut = 1 - Math.pow(1 - progress, 3);
        const currentVal = Math.floor(targetVal * easeOut);
        floatEl.textContent = `${prefix}${currentVal}`;
        if (progress < 1 && floatEl.isConnected) {
          requestAnimationFrame(updateSingleCounter);
        } else {
          floatEl.textContent = `${prefix}${targetVal}`;
        }
      };
      requestAnimationFrame(updateSingleCounter);
    }
    arena.appendChild(floatEl);
    floatEl.style.zIndex = isCriticalOrBig ? "35" : "30";
    const driftAngle = Math.atan2(finalY - centerY, finalX - centerX);
    const driftDistance = 40 + Math.random() * 20;
    const driftX = finalX + Math.cos(driftAngle) * driftDistance;
    const driftY = finalY - 30 + Math.sin(driftAngle) * (driftDistance * 0.5);
    const hitAnim = floatEl.animate([
      { opacity: 1, transform: `translate(calc(${finalX}px - 50%), calc(${finalY}px - 50%)) scale(${hitScale * 1.5})`, offset: 0 },
      { opacity: 1, transform: `translate(calc(${finalX}px - 50%), calc(${finalY}px - 50%)) scale(${hitScale})`, offset: 0.15 },
      { opacity: 1, transform: `translate(calc(${finalX}px - 50%), calc(${finalY}px - 50%)) scale(${hitScale})`, offset: 0.8 },
      { opacity: 0, transform: `translate(calc(${driftX}px - 50%), calc(${driftY}px - 50%)) scale(${hitScale * 0.9})`, offset: 1 }
    ], { duration: hitDuration / getEffectiveSpeed(), fill: "forwards", easing: "ease-out" });
    hitAnim.onfinish = () => floatEl.remove();
    if (isTargetCombo && displayValue > 0 && engineState.currentCombo.totalDamage > 0) {
      let cumulativeEl = arena.querySelector(`.cumulative-combo-damage[data-target-id="${affectedId}"]`);
      if (!cumulativeEl) {
        cumulativeEl = document.createElement("div");
        cumulativeEl.className = "floating-text cumulative-combo-damage";
        cumulativeEl.style.color = "#fc8181";
        cumulativeEl.style.fontSize = "48px";
        cumulativeEl.style.fontStyle = "italic";
        cumulativeEl.style.textShadow = "0 0 12px rgba(197, 48, 48, 1)";
        cumulativeEl.style.animation = "none";
        cumulativeEl.style.zIndex = "50";
        const sideOffset = targetActor && targetActor.side === "left" ? -90 : 90;
        cumulativeEl.style.left = `${centerX + sideOffset}px`;
        cumulativeEl.style.top = `${centerY - 40}px`;
        cumulativeEl.dataset.targetId = affectedId;
        cumulativeEl.dataset.currentTotal = "0";
        arena.appendChild(cumulativeEl);
      }
      const startVal = Number(cumulativeEl.dataset.currentTotal || 0);
      const endVal = engineState.currentCombo.targetDamages?.[frame.targetId] ?? displayValue;
      cumulativeEl.dataset.currentTotal = endVal.toString();
      const countDuration = 200;
      const startTime = performance.now();
      const updateCounter = (currentTime) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / countDuration, 1);
        const easeOut = 1 - Math.pow(1 - progress, 3);
        const currentVal = Math.floor(startVal + (endVal - startVal) * easeOut);
        cumulativeEl.textContent = `-${currentVal}`;
        if (progress < 1 && cumulativeEl.isConnected) {
          requestAnimationFrame(updateCounter);
        } else {
          cumulativeEl.textContent = `-${endVal}`;
        }
      };
      requestAnimationFrame(updateCounter);
      const comboScale = Math.min(2.5, 1 + targetHitCount * 0.12);
      const isTargetLastHit = !isNextFrameSameCombo || isNextTargetDifferent;
      if (cumulativeEl.getAnimations) {
        cumulativeEl.getAnimations().forEach((anim) => anim.cancel());
      }
      const baseComboTransform = "translate(-50%, -50%)";
      let comboKeyframes;
      let comboDuration;
      if (isTargetLastHit) {
        comboDuration = 2800 / getEffectiveSpeed();
        comboKeyframes = [
          { opacity: 0.8, transform: `${baseComboTransform} scale(${comboScale * 1.3})`, offset: 0 },
          { opacity: 1, transform: `${baseComboTransform} scale(${comboScale * 1.8})`, offset: 0.1 },
          { opacity: 1, transform: `${baseComboTransform} scale(${comboScale})`, offset: 0.25 },
          { opacity: 1, transform: `${baseComboTransform} scale(${comboScale})`, offset: 0.85 },
          { opacity: 0, transform: `${baseComboTransform} scale(${comboScale * 0.9}) translateY(-30px)`, offset: 1 }
        ];
      } else {
        comboDuration = 800 / getEffectiveSpeed();
        comboKeyframes = [
          { opacity: 0.9, transform: `${baseComboTransform} scale(${comboScale * 1.2})`, offset: 0 },
          { opacity: 1, transform: `${baseComboTransform} scale(${comboScale})`, offset: 0.2 },
          { opacity: 1, transform: `${baseComboTransform} scale(${comboScale})`, offset: 0.99 },
          { opacity: 0, transform: `${baseComboTransform} scale(${comboScale * 0.9}) translateY(-10px)`, offset: 1 }
        ];
      }
      const comboAnim = cumulativeEl.animate(comboKeyframes, { duration: comboDuration, fill: "forwards" });
      comboAnim.onfinish = () => {
        if (cumulativeEl.isConnected) cumulativeEl.remove();
      };
    }
  }

  // src/mvp.js
  function showMVPPanel() {
    const sr = engineState.shadowRoot;
    if (!sr || sr.getElementById("mdbv-mvp-panel")) return;
    const { consolidated, mvp, maxTotalDamage } = getConsolidatedStats();
    const theme = engineState.battleResult === "WIN" ? { main: "#f6e05e", dark: "#1a202c", text: "VICTORY", sub: "\u52DD\u5229", accent: "#d69e2e" } : { main: "#fc8181", dark: "#2d3748", text: "DEFEAT", sub: "\u6557\u5317", accent: "#c53030" };
    const overlay = document.createElement("div");
    overlay.id = "mdbv-mvp-panel";
    overlay.style.cssText = `
        position: absolute; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(10, 15, 25, 0.95); z-index: 3000;
        overflow: hidden;
        font-family: Impact, "Arial Black", "Noto Sans TC", sans-serif;
        animation: panelFadeIn 0.5s ease-out forwards;
    `;
    const style = document.createElement("style");
    style.textContent = `
        @keyframes panelFadeIn { 0% { opacity: 0; } 100% { opacity: 1; } }
        @keyframes slideInLeft { 0% { transform: translateX(-50px) skewX(-10deg); opacity: 0; } 100% { transform: translateX(0) skewX(-10deg); opacity: 1; } }
        @keyframes slideInRight { 0% { transform: translateX(100px); opacity: 0; } 100% { transform: translateX(0); opacity: 1; } }
        @keyframes barGrow { 0% { width: 0; } 100% { width: var(--target-width); } }
        @keyframes bgScroll { 0% { background-position: 0 0; } 100% { background-position: -80px 80px; } }

        .jrpg-bg-stripes { position: absolute; top: -50%; left: -50%; width: 200%; height: 200%; background-image: repeating-linear-gradient(45deg, transparent, transparent 20px, rgba(255,255,255,0.02) 20px, rgba(255,255,255,0.02) 40px); animation: bgScroll 8s linear infinite; z-index: 1; pointer-events: none; }
        .mvp-splash { position: absolute; right: -5%; top: 0; height: 100%; width: 60%; background: ${theme.dark}; clip-path: polygon(15% 0, 100% 0, 100% 100%, 0% 100%); z-index: 2; border-left: none; animation: slideInRight 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards; display: flex; align-items: center; justify-content: center; overflow: hidden; pointer-events: none; }
        .mvp-avatar { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; object-position: center 20%; transform: scale(1.05); filter: drop-shadow(10px 10px 0px rgba(0,0,0,0.5)); z-index: 1; }
        .ui-container { position: absolute; left: 5%; top: 10%; height: 80%; width: 50%; z-index: 3; display: flex; flex-direction: column; justify-content: space-between; }
        .title-group { transform: skewX(-10deg); animation: slideInLeft 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .title-main { font-size: clamp(60px, 10vw, 120px); color: transparent; -webkit-text-stroke: 3px ${theme.main}; letter-spacing: 10px; margin: 0; line-height: 1; text-shadow: 6px 6px 0px ${theme.accent}; }
        .title-sub { font-size: 32px; background: ${theme.main}; display: inline-block; padding: 5px 20px; color: ${theme.dark}; font-weight: 900; letter-spacing: 8px; }
        .stats-container { display: flex; flex-direction: column; gap: 12px; transform: skewX(-10deg); }
        .stat-row { display: flex; align-items: center; background: rgba(0,0,0,0.6); padding: 10px 15px 10px 20px; border-left: 5px solid ${theme.main}; backdrop-filter: blur(4px); opacity: 0; animation: slideInLeft 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .stat-name { width: 130px; padding-left: 5px; font-size: 20px; color: #fff; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transform: skewX(10deg); }
        .stat-bar-wrapper { flex: 1; height: 24px; background: rgba(255,255,255,0.1); margin: 0 20px; position: relative; overflow: hidden; }
        .stat-bar-fill { height: 100%; background: ${theme.main}; box-shadow: inset 0 -5px 0 rgba(0,0,0,0.3); width: 0; animation: barGrow 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .stat-numbers { width: 140px; text-align: right; transform: skewX(10deg); }
        .stat-dmg { font-size: 24px; color: ${theme.main}; }
        .stat-taken { font-size: 14px; color: #a0aec0; }
        .close-btn { align-self: flex-start; margin-top: 30px; background: ${theme.main}; color: ${theme.dark}; border: none; padding: 15px 40px; font-size: 24px; font-weight: 900; cursor: pointer; transform: skewX(-10deg); box-shadow: 4px 4px 0 rgba(0,0,0,0.5); opacity: 0; transition: transform 0.1s, box-shadow 0.1s; animation: slideInLeft 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .close-btn:hover { transform: skewX(-10deg) translate(-2px, -2px); box-shadow: 6px 6px 0 rgba(0,0,0,0.5); }
        .close-btn:active { transform: skewX(-10deg) translate(2px, 2px); box-shadow: 2px 2px 0 rgba(0,0,0,0.5); }
        .mvp-label { position: absolute; left: 12%; top: 40px; background: ${theme.main}; color: ${theme.dark}; padding: 10px 30px; font-size: 28px; font-weight: 900; transform: skewX(-15deg); box-shadow: 5px 5px 0 rgba(0,0,0,0.5); z-index: 10; letter-spacing: 4px; }
    `;
    overlay.appendChild(style);
    const bgStripes = document.createElement("div");
    bgStripes.className = "jrpg-bg-stripes";
    overlay.appendChild(bgStripes);
    if (mvp) {
      const mvpSplash = document.createElement("div");
      mvpSplash.className = "mvp-splash";
      const mvpLabel = document.createElement("div");
      mvpLabel.className = "mvp-label";
      mvpLabel.textContent = mvp.name;
      const mvpImg = document.createElement("img");
      mvpImg.className = "mvp-avatar";
      mvpImg.src = mvp.avatar;
      mvpImg.onerror = () => {
        mvpImg.src = DEFAULT_MVP_AVATAR_URL;
      };
      mvpSplash.appendChild(mvpLabel);
      mvpSplash.appendChild(mvpImg);
      overlay.appendChild(mvpSplash);
    }
    const uiContainer = document.createElement("div");
    uiContainer.className = "ui-container";
    const titleGroup = document.createElement("div");
    titleGroup.className = "title-group";
    titleGroup.innerHTML = `
        <div class="title-sub">${theme.sub}</div>
        <h1 class="title-main">${theme.text}</h1>
    `;
    uiContainer.appendChild(titleGroup);
    const statsContainer = document.createElement("div");
    statsContainer.className = "stats-container";
    const headerRow = document.createElement("div");
    headerRow.style.cssText = "display: flex; color: #a0aec0; font-family: sans-serif; font-size: 12px; margin-bottom: 5px; transform: skewX(10deg); padding-left: 15px;";
    headerRow.innerHTML = `
        <div style="width: 120px;">MEMBER</div>
        <div style="flex: 1; margin: 0 20px;">CONTRIBUTION</div>
        <div style="width: 140px; text-align: right;">OUTPUT / STATS</div>
    `;
    statsContainer.appendChild(headerRow);
    const animateValue = (element, endValue, delay) => {
      let startTimestamp = null;
      const duration = 800;
      const step = (timestamp) => {
        if (!element.isConnected) return;
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        const easeOut = 1 - Math.pow(1 - progress, 3);
        element.textContent = Math.floor(easeOut * endValue).toLocaleString("en-US");
        if (progress < 1) {
          window.requestAnimationFrame(step);
        } else {
          element.textContent = Math.round(endValue).toLocaleString("en-US");
        }
      };
      setTimeout(() => {
        window.requestAnimationFrame(step);
      }, delay * 1e3);
    };
    let delayCounter = 0.4;
    consolidated.forEach((stats) => {
      if (stats.actor.isSummon) return;
      const { actor, totalOutput, totalTaken, totalHealing = 0 } = stats;
      const dmgPct = maxTotalDamage > 0 ? totalOutput / maxTotalDamage * 100 : 0;
      const formatNum = (num) => Math.round(num).toLocaleString("en-US");
      const isHealHigher = totalHealing > totalTaken;
      const subLabel = isHealHigher ? "HEAL" : "TAKEN";
      const subValue = isHealHigher ? totalHealing : totalTaken;
      const row = document.createElement("div");
      row.className = "stat-row";
      row.style.animationDelay = `${delayCounter}s`;
      row.innerHTML = `
            <div class="stat-name">${escapeHtml(actor.name)}</div>
            <div class="stat-bar-wrapper">
                <div class="stat-bar-fill" style="--target-width: ${dmgPct}%; animation-delay: ${delayCounter + 0.2}s;"></div>
            </div>
            <div class="stat-numbers">
                <div class="stat-dmg">0</div>
                <div class="stat-taken">${subLabel}: ${formatNum(subValue)}</div>
            </div>
        `;
      statsContainer.appendChild(row);
      setTimeout(() => {
        const dmgEl = row.querySelector(".stat-dmg");
        if (dmgEl) animateValue(dmgEl, totalOutput, delayCounter + 0.2);
      }, 0);
      delayCounter += 0.1;
    });
    const closeBtn = document.createElement("button");
    closeBtn.className = "close-btn";
    closeBtn.textContent = "NEXT // \u7D50\u675F\u6F14\u51FA";
    closeBtn.style.animationDelay = `${delayCounter + 0.2}s`;
    closeBtn.onclick = () => closeBattleStage();
    uiContainer.appendChild(statsContainer);
    uiContainer.appendChild(closeBtn);
    overlay.appendChild(uiContainer);
    sr.appendChild(overlay);
  }

  // src/spoilerGuard.js
  var DEATH_BANNER_TEXT = "\u4F60\u7684\u89D2\u8272\u6B7B\u4EA1\u4E86\uFF0C\u8ACB\u9032\u884C\u8F49\u751F";
  var PARTY_STATUS_REGEX = /^.+ · Lv\.\d+ · (死亡|存活)$/;
  var isGuardArmed = false;
  var guardTimeoutId = null;
  var observerStarted = false;
  var scanScheduled = false;
  function ensureSpoilerStyle() {
    if (document.getElementById("mdbv-spoiler-style")) return;
    const style = document.createElement("style");
    style.id = "mdbv-spoiler-style";
    style.textContent = `
        [data-mdbv-hide] { visibility: hidden !important; }
        [data-mdbv-gone] { display: none !important; }
        [data-mdbv-dialog-pending] { opacity: 0 !important; pointer-events: none !important; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }
  function applySpoilerMask() {
    if (!isGuardArmed) return;
    ensureSpoilerStyle();
    document.querySelectorAll("div:not([data-mdbv-gone])").forEach((div) => {
      if (div.childElementCount === 0 && div.textContent.trim() === DEATH_BANNER_TEXT) {
        div.setAttribute("data-mdbv-gone", "");
      }
    });
    document.querySelectorAll("p:not([data-mdbv-hide])").forEach((p) => {
      if (p.childElementCount === 0 && PARTY_STATUS_REGEX.test(p.textContent.trim())) {
        p.setAttribute("data-mdbv-hide", "");
      }
    });
    document.querySelectorAll('[role="dialog"]').forEach((dlg) => {
      const titleEl = Array.from(dlg.querySelectorAll("h2, h3, p, div")).find(
        (el) => el.childElementCount === 0 && el.textContent.trim() === "\u6230\u5831"
      );
      if (titleEl) {
        let sibling = titleEl.nextElementSibling;
        while (sibling) {
          if (!sibling.hasAttribute("data-mdbv-hide")) {
            sibling.setAttribute("data-mdbv-hide", "");
          }
          sibling = sibling.nextElementSibling;
        }
        if (!dlg.hasAttribute("data-mdbv-dialog-pending")) {
          dlg.setAttribute("data-mdbv-dialog-pending", "");
        }
      }
    });
  }
  function armSpoilerGuard(timeoutMs = 45e3) {
    isGuardArmed = true;
    applySpoilerMask();
    clearTimeout(guardTimeoutId);
    if (timeoutMs > 0) {
      guardTimeoutId = setTimeout(() => {
        if (!document.getElementById("mdbv-host")) {
          releaseSpoilerGuard();
        }
      }, timeoutMs);
    }
  }
  function releaseSpoilerGuard() {
    isGuardArmed = false;
    clearTimeout(guardTimeoutId);
    document.querySelectorAll("[data-mdbv-hide]").forEach((el) => el.removeAttribute("data-mdbv-hide"));
    document.querySelectorAll("[data-mdbv-gone]").forEach((el) => el.removeAttribute("data-mdbv-gone"));
    document.querySelectorAll("[data-mdbv-dialog-pending]").forEach((el) => el.removeAttribute("data-mdbv-dialog-pending"));
  }
  function scheduleMaskScan() {
    if (!isGuardArmed || scanScheduled) return;
    scanScheduled = true;
    queueMicrotask(() => {
      scanScheduled = false;
      try {
        if (isGuardArmed) applySpoilerMask();
      } catch (_err) {
      }
    });
  }
  function initSpoilerObserver() {
    if (observerStarted) return;
    observerStarted = true;
    const observer = new MutationObserver(scheduleMaskScan);
    const startObserving = () => {
      if (document.documentElement) {
        observer.observe(document.documentElement, { childList: true, subtree: true });
      }
    };
    if (document.documentElement) {
      startObserving();
    } else {
      document.addEventListener("DOMContentLoaded", startObserving, { once: true });
    }
  }

  // src/stageSync.js
  function createLogLineElement(frame) {
    const msgEl = document.createElement("div");
    const speaker = resolveDialogueSpeaker(frame);
    const isDialogue = Boolean(speaker) || frame.type === "DIALOGUE" && /[「『"“]/.test(frame.message);
    const isNarrative = !isDialogue && isSceneNarrationFrame(frame);
    let logClass = "system-log";
    if (isDialogue) {
      logClass = "dialogue-log";
    } else if (isNarrative) {
      logClass = "narrative-log";
    }
    msgEl.className = `log-line ${logClass}`;
    msgEl.dataset.frameIndex = String(frame.index);
    msgEl.title = `\u9EDE\u64CA\u8DF3\u8F49\u81F3\u6B64\u5F71\u683C (#${frame.index + 1})`;
    const formattedMsg = formatLogMessage(frame.message, engineState.actors);
    msgEl.innerHTML = `<span class="log-index" style="color:#718096; margin-right:8px;">[${frame.index + 1}]</span> ${formattedMsg}`;
    return msgEl;
  }
  function syncActorBondVisuals(sr, bondStateMap = null) {
    engineState.actors.forEach((actor) => {
      const wrapperEl = sr.getElementById(`actor-${actor.id}`);
      if (!wrapperEl) return;
      const bondInfo = bondStateMap ? bondStateMap.get(actor.id) : null;
      const existingBadge = wrapperEl.querySelector(".bond-ring-badge");
      if (bondInfo) {
        const profile = getContractSkillProfile(bondInfo.skillId);
        wrapperEl.classList.add("bond-active");
        if (!existingBadge) {
          const badge = document.createElement("div");
          badge.className = "bond-ring-badge";
          const partner = bondInfo.partnerId ? engineState.actors.get(bondInfo.partnerId) : null;
          badge.textContent = partner ? `${profile?.badgeIcon || "\u{1F48D}"} ${partner.name}` : `${profile?.badgeIcon || "\u{1F48D}"} ${profile?.badgeText || "\u5951\u7D04"}`;
          wrapperEl.appendChild(badge);
        }
      } else {
        wrapperEl.classList.remove("bond-active");
        if (existingBadge) existingBadge.remove();
      }
    });
  }
  function syncActorHpAndDeathDOM(sr, frame, {
    skipHpTransition = false,
    syncSummonVisibility = false,
    deferDeadClassForActorId = null
  } = {}) {
    frame.actorsHpState.forEach((currentHp, actorId) => {
      const actor = engineState.actors.get(actorId);
      const fillEl = sr.getElementById(`hp-fill-${actorId}`);
      const textEl = sr.getElementById(`hp-text-${actorId}`);
      const wrapperEl = sr.getElementById(`actor-${actorId}`);
      if (syncSummonVisibility && wrapperEl) {
        const isSpawned = frame.actorsSummonState ? frame.actorsSummonState.get(actorId) !== false : actor?.initiallySpawned !== false;
        wrapperEl.classList.remove("spawning", "despawning");
        if (!isSpawned) wrapperEl.classList.add("unspawned");
        else wrapperEl.classList.remove("unspawned");
      }
      if (!actor) return;
      const isDead = frame.actorsDeathState ? frame.actorsDeathState.get(actorId) : currentHp <= 0;
      if (fillEl && textEl && !actor.hideHp) {
        const pct = currentHp / actor.maxHp * 100;
        if (skipHpTransition) {
          fillEl.style.transition = "none";
          fillEl.style.width = `${Math.max(0, Math.min(100, pct))}%`;
          setTimeout(() => {
            fillEl.style.transition = "";
          }, 50);
        } else {
          fillEl.style.width = `${Math.max(0, Math.min(100, pct))}%`;
        }
        textEl.textContent = `${Math.round(currentHp)}/${actor.maxHp}`;
        fillEl.classList.remove("warning", "danger");
        if (currentHp > 0 && pct <= 25) {
          fillEl.classList.add("danger");
          if (wrapperEl && !isDead) wrapperEl.classList.add("danger-state");
        } else if (currentHp > 0 && pct <= 50) {
          fillEl.classList.add("warning");
          if (wrapperEl) wrapperEl.classList.remove("danger-state");
        } else {
          if (wrapperEl) wrapperEl.classList.remove("danger-state");
        }
      }
      actor.currentHp = currentHp;
      if (isDead && wrapperEl) {
        const shouldDefer = deferDeadClassForActorId instanceof Set ? deferDeadClassForActorId.has(actorId) : deferDeadClassForActorId === actorId;
        if (!shouldDefer) {
          wrapperEl.classList.add("dead");
        }
        wrapperEl.classList.remove("danger-state");
      } else if (!isDead && wrapperEl) {
        wrapperEl.classList.remove("dead");
      }
    });
  }
  function renderSeekPreviewState(sr, frameIndex) {
    const arena = sr.getElementById("arena");
    const frame = engineState.frames[frameIndex];
    if (!arena || !frame) return;
    const speed = getEffectiveSpeed();
    engineState.currentCombo = createEmptyCombo();
    let turnStartIdx = frameIndex;
    while (turnStartIdx > 0 && engineState.frames[turnStartIdx - 1]?.turnNumber === frame.turnNumber) {
      turnStartIdx--;
    }
    for (let i = turnStartIdx; i <= frameIndex; i++) {
      const f = engineState.frames[i];
      if (f.actorId && ["DAMAGE", "MISS", "COUNTER", "BLOCK"].includes(f.type) && !f.isCounterSetup) {
        const lookahead = lookaheadComboState(i, f);
        advanceComboState(f, lookahead.isNextFrameSameCombo);
      }
    }
    if (engineState.currentCombo.count > 1 && ["DAMAGE", "MISS", "BLOCK"].includes(frame.type) && !frame.isCounter) {
      renderComboBanner(arena, frame, speed);
    }
    const activeCasterId = frame.aoeCasterId || frame.actorId;
    let skillContextFrame = null;
    if (frame.type !== "SKILL_TEXT") {
      for (let i = frameIndex - 1; i >= Math.max(0, turnStartIdx - 1); i--) {
        const prev = engineState.frames[i];
        if (prev.turnNumber !== frame.turnNumber) break;
        if (prev.type === "SKILL_TEXT" && (!activeCasterId || prev.actorId === activeCasterId)) {
          skillContextFrame = prev;
          break;
        }
      }
    }
    let actionLabel = "\u{1F4DC} \u6230\u6CC1\u7D00\u9304";
    if (frame.isAOE) actionLabel = "\u{1F4A5} \u7BC4\u570D\u653B\u64CA (AOE)";
    else if (frame.isCoverEvent) actionLabel = "\u{1F6E1}\uFE0F \u8B77\u885B\u4EE3\u511F (COVER)";
    else if (frame.type === "COUNTER" || frame.isCounter) actionLabel = "\u26A1 \u53CD\u64CA\u4EA4\u92D2 (COUNTER)";
    else if (frame.skillTier === "ultimate") actionLabel = "\u2728 \u5967\u7FA9\u767C\u52D5 (ULTIMATE)";
    else if (frame.type === "HEAL" || frame.isBeneficial) actionLabel = "\u{1F49A} \u6062\u5FA9 / \u589E\u76CA";
    else if (frame.type === "SUMMON" || frame.isSummonEvent) actionLabel = "\u{1F300} \u53EC\u559A\u767B\u5834";
    else if (frame.type === "SKILL_TEXT") actionLabel = "\u{1F52E} \u6280\u80FD\u65BD\u5C55";
    else if (["DAMAGE", "BLOCK", "MISS"].includes(frame.type)) actionLabel = "\u2694\uFE0F \u6230\u9B25\u4EA4\u92D2";
    const actorObj = activeCasterId ? engineState.actors.get(activeCasterId) : null;
    const targetObj = frame.targetId ? engineState.actors.get(frame.targetId) : null;
    let engagementHtml = "";
    if (actorObj && frame.isAOE) {
      engagementHtml = `<span>\u767C\u8D77\u5168\u9AD4\u653B\u64CA</span>`;
    } else if (actorObj && targetObj && actorObj !== targetObj) {
      engagementHtml = `<span>\u5C0D <strong>${escapeHtml(targetObj.name)}</strong></span>`;
    }
    const bannerEl = document.createElement("div");
    bannerEl.className = "seek-situation-banner";
    const skillPill = frame.skillName ? `<span class="seek-skill-pill">${escapeHtml(frame.skillName)}</span>` : "";
    const skillContextHtml = skillContextFrame ? `<span class="seek-skill-context">\u3010${escapeHtml(skillContextFrame.skillName || skillContextFrame.message)}\u3011</span>` : "";
    bannerEl.innerHTML = `
        <div class="seek-banner-header">
            <span class="seek-turn-pill">TURN ${frame.turnNumber}</span>
            <span>${actionLabel}</span>
            ${skillPill}
            ${skillContextHtml}
            ${engagementHtml}
        </div>
        <div class="seek-banner-body">
            ${formatLogMessage(frame.message, engineState.actors)}
        </div>
    `;
    arena.appendChild(bannerEl);
    const actorEl = activeCasterId ? sr.getElementById(`actor-${activeCasterId}`) : null;
    const targetEl = frame.targetId ? sr.getElementById(`actor-${frame.targetId}`) : null;
    if (actorEl) actorEl.classList.add("seek-acting");
    if (targetEl && targetEl !== actorEl) targetEl.classList.add("seek-targeted");
    const arenaRect = arena.getBoundingClientRect();
    if (frame.isAOE && actorEl) {
      const aRect = actorEl.getBoundingClientRect();
      const cMoveX = arenaRect.left + arenaRect.width / 2 - (aRect.left + aRect.width / 2);
      const cDeltaY = arenaRect.top + arenaRect.height / 2 - (aRect.top + aRect.height / 2);
      const side = actorObj?.side || "left";
      const targetSide = targetObj?.side || (side === "left" ? "right" : "left");
      const shadowColor = side === "left" ? "#63b3ed" : "#fc8181";
      actorEl.style.zIndex = "10";
      actorEl.style.transform = `translate(${cMoveX}px, ${cDeltaY}px) scale(1.2)`;
      actorEl.style.filter = `drop-shadow(0 0 14px ${shadowColor})`;
      const centerStageX = arenaRect.width / 2;
      const centerStageY = arenaRect.height / 2;
      spawnAOEFanWave(arena, centerStageX, centerStageY, targetSide, shadowColor, speed);
      if (targetEl) {
        spawnAOEProjectile(arena, centerStageX, centerStageY, targetEl, shadowColor, 0, 140, speed);
        triggerAOETargetImpact(frame, arena, targetEl, targetSide, shadowColor, speed);
      }
    } else if (frame.isCoverEvent && actorEl) {
      const protectedEl = frame.coverProtectedId ? sr.getElementById(`actor-${frame.coverProtectedId}`) : null;
      if (protectedEl) {
        const gRect = actorEl.getBoundingClientRect();
        const pRect = protectedEl.getBoundingClientRect();
        const gSide = actorObj?.side || "left";
        const guardOffsetX = pRect.left - gRect.left + (gSide === "left" ? 55 : -55);
        const guardOffsetY = pRect.top - gRect.top;
        actorEl.style.zIndex = "15";
        actorEl.style.transform = `translate(${guardOffsetX}px, ${guardOffsetY}px) scale(1.12)`;
        actorEl.style.filter = "drop-shadow(0 0 16px #f687b3)";
      }
    } else if (actorEl && targetEl && actorEl !== targetEl && ["DAMAGE", "MISS", "COUNTER", "BLOCK"].includes(frame.type) && !frame.isSelfDamage && !frame.isEnvironmentalPulse) {
      const aRect = actorEl.getBoundingClientRect();
      const tRect = targetEl.getBoundingClientRect();
      const side = actorObj?.side || "left";
      const targetSide = targetObj?.side || (side === "left" ? "right" : "left");
      const shadowColor = side === "left" ? "#63b3ed" : "#fc8181";
      const moveX = tRect.left - aRect.left + (side === "left" ? -60 : 60);
      const deltaY = tRect.top - aRect.top;
      actorEl.style.zIndex = "10";
      actorEl.style.transform = `translate(${moveX}px, ${deltaY}px) scale(1.1)`;
      actorEl.style.filter = `drop-shadow(0 0 12px ${shadowColor})`;
      triggerAOETargetImpact(frame, arena, targetEl, targetSide, shadowColor, speed);
    }
    const speaker = resolveDialogueSpeaker(frame);
    if (speaker) {
      renderSpeechBubble(frame, sr, engineState.playbackToken);
    } else if (isSceneNarrationFrame(frame)) {
      renderSceneNarrationBanner(frame, sr, engineState.playbackToken);
    }
    if (frame.diceCheck || ["FATIGUE", "FATIGUE_SKIP", "SILENCED", "SKILL_TEXT", "TEXT"].includes(frame.type)) {
      spawnStatusOrDiceBadge(frame, sr);
    }
    spawnFloatingText(frame, sr, false, false);
  }
  function syncStageToAbsoluteState(frameIndex, isInitialReset = false, showActivePreview = false) {
    const sr = engineState.shadowRoot;
    if (!sr) return;
    engineState.currentCombo = createEmptyCombo();
    engineState.floatTracker.clear();
    const mvpPanel = sr.getElementById("mdbv-mvp-panel");
    if (mvpPanel) mvpPanel.remove();
    const fatalityOverlay = sr.getElementById("fatality-overlay");
    if (fatalityOverlay) fatalityOverlay.classList.remove("active");
    sr.querySelectorAll(
      ".ultimate-overlay, .contract-cutin-overlay, .rosario-cross-mark, .bridal-cover-shield, .speech-bubble, .dice-badge, .floating-text, .combo-text, .luck-drop, .break-stamp, .fatality-slash, .fatality-text, .seek-situation-banner, .aoe-fan-wave, .aoe-projectile, .arena-field-wave, .scene-narration-banner"
    ).forEach((el) => el.remove());
    engineState.actors.forEach((actor) => {
      actor.lastUltimateTurn = null;
      const el = sr.getElementById(`actor-${actor.id}`);
      if (el) {
        if (el.getAnimations) el.getAnimations().forEach((anim) => anim.cancel());
        el.style.filter = "";
        el.style.transform = "";
        el.style.zIndex = "";
        el.classList.remove("blink-active", "spawning", "despawning", "seek-acting", "seek-targeted");
      }
    });
    const stateFrameIndex = Math.max(0, Math.min(frameIndex, engineState.frames.length - 1));
    const dialog = sr.getElementById("dialog-box");
    if (dialog) {
      dialog.innerHTML = "";
      if (!isInitialReset && engineState.frames.length > 0) {
        const fragment = document.createDocumentFragment();
        const limit = showActivePreview ? Math.min(stateFrameIndex, engineState.frames.length - 1) : Math.min(stateFrameIndex - 1, engineState.frames.length - 1);
        const startLogIdx = Math.max(0, limit - 30);
        for (let i = startLogIdx; i <= limit; i++) {
          const f = engineState.frames[i];
          if (f && f.message) {
            const lineEl = createLogLineElement(f);
            if (showActivePreview && i === stateFrameIndex) {
              lineEl.classList.add("current-frame-log");
            }
            fragment.appendChild(lineEl);
          }
        }
        dialog.appendChild(fragment);
        dialog.scrollTop = dialog.scrollHeight;
      }
    }
    if (engineState.frames.length === 0) return;
    if (isInitialReset) {
      engineState.actors.forEach((actor) => {
        actor.currentHp = actor.maxHp;
        const fillEl = sr.getElementById(`hp-fill-${actor.id}`);
        const textEl = sr.getElementById(`hp-text-${actor.id}`);
        const wrapperEl = sr.getElementById(`actor-${actor.id}`);
        if (wrapperEl) {
          wrapperEl.classList.remove("dead", "danger-state");
          if (actor.initiallySpawned === false) wrapperEl.classList.add("unspawned");
          else wrapperEl.classList.remove("unspawned");
        }
        if (fillEl && textEl && !actor.hideHp) {
          fillEl.style.transition = "none";
          fillEl.style.width = "100%";
          fillEl.classList.remove("warning", "danger");
          textEl.textContent = `${actor.maxHp}/${actor.maxHp}`;
        }
      });
      updateATBUI(1, true);
      syncActorBondVisuals(sr, null);
    } else {
      const frame = engineState.frames[stateFrameIndex];
      if (!frame) return;
      syncActorHpAndDeathDOM(sr, frame, {
        skipHpTransition: true,
        syncSummonVisibility: true,
        deferDeadClassForActorId: null
      });
      updateATBUI(frame.turnNumber, true, frame.actorsSummonState);
      syncActorBondVisuals(sr, frame.actorsBondState);
      if (showActivePreview) {
        renderSeekPreviewState(sr, stateFrameIndex);
      }
    }
  }

  // src/timeline.js
  function isPrimaryUltimateTriggerFrame(frame) {
    if (frame.skillTier !== "ultimate" || !["SKILL_TEXT", "TEXT", "DAMAGE"].includes(frame.type) || frame.isNormalAttack || ULTIMATE_CUTIN_EXCLUDED_SKILLS.has(frame.skillId)) {
      return false;
    }
    return true;
  }
  function extractTimelineMarkers(frames) {
    if (!Array.isArray(frames) || frames.length === 0) return [];
    const markers = [];
    const lastUltTurnByActor = /* @__PURE__ */ new Map();
    frames.forEach((f, idx) => {
      const events = [];
      if (f.rebirthHeal) {
        const targetId = f.targetId || f.actorId;
        const actorName = engineState.actors.get(targetId)?.name || "Boss";
        events.push({
          priority: 5,
          category: "rebirth",
          icon: "\u{1F525}",
          title: `\u{1F525} \u4E8C\u968E\u6BB5\u7526\u9192\uFF1A${actorName}`
        });
      }
      if (f.isDeathEvent && f.deadActorId) {
        const deadName = engineState.actors.get(f.deadActorId)?.name || f.deadActorId;
        events.push({
          priority: 4,
          category: "death",
          icon: "\u{1F480}",
          title: `\u{1F480} \u9663\u4EA1\uFF1A${deadName}`
        });
      }
      if (isPrimaryUltimateTriggerFrame(f)) {
        const msg = String(f.message || "").trim();
        const isSubFrame = ULTIMATE_SUBFRAME_REGEX.test(msg) || f.rosarioEvent === "INSCRIBE_CROSS";
        if (!isSubFrame && lastUltTurnByActor.get(f.actorId) !== f.turnNumber) {
          lastUltTurnByActor.set(f.actorId, f.turnNumber);
          const actorName = engineState.actors.get(f.actorId)?.name || f.actorId;
          events.push({
            priority: 3,
            category: "ultimate",
            icon: "\u{1F31F}",
            title: `\u{1F31F} \u5967\u7FA9\u767C\u52D5\uFF1A${actorName}`
          });
        } else if (isSubFrame) {
          lastUltTurnByActor.set(f.actorId, f.turnNumber);
        }
      }
      if (f.contractEvent === "ACCEPT") {
        const actorName = engineState.actors.get(f.actorId)?.name || f.actorId;
        const partnerName = f.targetId ? engineState.actors.get(f.targetId)?.name : null;
        events.push({
          priority: 2,
          category: "contract",
          icon: "\u{1F48D}",
          title: `\u{1F48D} \u5951\u7D04\u7DE0\u7D50\uFF1A${actorName}${partnerName ? ` & ${partnerName}` : ""}`
        });
      }
      if (f.isSummonEvent && f.summonedActorId) {
        const summonName = engineState.actors.get(f.summonedActorId)?.name || f.summonedActorId;
        events.push({
          priority: 1,
          category: "summon",
          icon: "\u{1F300}",
          title: `\u{1F300} \u53EC\u559A\u767B\u5834\uFF1A${summonName}`
        });
      }
      if (events.length > 0) {
        events.sort((a, b) => b.priority - a.priority);
        const top = events[0];
        const combinedTitle = events.map((e) => e.title).join(" \uFF5C ");
        const rawMsg = String(f.message || "").replace(/\s+/g, " ").trim();
        const detail = rawMsg.length > 46 ? `${rawMsg.slice(0, 46)}\u2026` : rawMsg;
        markers.push({
          frameIndex: idx,
          turnNumber: f.turnNumber,
          category: top.category,
          icon: top.icon,
          title: combinedTitle,
          detail
        });
      }
    });
    return markers;
  }
  function updateATBUI(currentTurn, skipTransition = false, summonStateMap = null) {
    const sr = engineState.shadowRoot;
    if (!sr) return;
    const track = sr.getElementById("ctb-track");
    if (!track) return;
    engineState.actors.forEach((actor) => {
      if (actor.currentHp <= 0 && actor.turnNumbers.length === 0) return;
      const isSpawned = summonStateMap ? summonStateMap.get(actor.id) !== false : actor.initiallySpawned !== false;
      let progress = 0;
      const turns = actor.turnNumbers;
      if (turns.length === 0) {
        progress = 0;
      } else if (currentTurn <= turns[0]) {
        progress = turns[0] > 0 ? currentTurn / turns[0] * 100 : 100;
      } else {
        let prev = turns[0];
        let next = null;
        for (let i = 0; i < turns.length; i++) {
          if (turns[i] === currentTurn) {
            progress = 100;
            prev = turns[i];
            next = turns[i];
            break;
          } else if (turns[i] > currentTurn) {
            next = turns[i];
            break;
          } else {
            prev = turns[i];
          }
        }
        if (progress !== 100) {
          if (next !== null) {
            progress = (currentTurn - prev) / (next - prev) * 100;
          } else {
            const avgGap = turns.length > 1 ? (turns[turns.length - 1] - turns[0]) / (turns.length - 1) : 4;
            progress = (currentTurn - prev) / avgGap * 100;
            progress = Math.min(95, progress);
          }
        }
      }
      progress = Math.max(0, Math.min(100, progress));
      let icon = sr.getElementById(`ctb-icon-${actor.id}`);
      if (!icon) {
        icon = document.createElement("div");
        icon.id = `ctb-icon-${actor.id}`;
        icon.className = `ctb-icon ${actor.side}`;
        icon.innerHTML = `<img src="${escapeHtml(actor.avatar)}" onerror="this.src='${DEFAULT_AVATAR_URL}'">`;
        track.appendChild(icon);
      }
      icon.style.zIndex = Math.round(progress);
      const prevProgress = Number(icon.dataset.progress || 0);
      if (skipTransition || progress < prevProgress - 20) {
        icon.style.transition = "none";
        icon.style.left = `${progress}%`;
        void icon.offsetHeight;
      } else {
        icon.style.transition = `left ${400 / getEffectiveSpeed()}ms linear`;
        icon.style.left = `${progress}%`;
      }
      if (progress === 100) icon.classList.add("acting");
      else icon.classList.remove("acting");
      if (!isSpawned || actor.currentHp <= 0 && progress !== 100) {
        icon.style.opacity = "0";
      } else {
        icon.style.opacity = "1";
      }
      icon.dataset.progress = progress;
    });
  }

  // src/reportIO.js
  function extractBattlePayload(obj, depth = 0) {
    if (!obj || typeof obj !== "object" || depth > 3) return null;
    if (Array.isArray(obj.logs) && obj.logs.some((l) => l && typeof l === "object")) {
      return obj;
    }
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (val && typeof val === "object" && !Array.isArray(val)) {
        const found = extractBattlePayload(val, depth + 1);
        if (found) return found;
      }
    }
    return null;
  }
  function sanitizeFilenameSegment(name) {
    return String(name || "unknown").replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "unit";
  }
  function toSerializableImagePath(avatarUrl) {
    if (!avatarUrl || typeof avatarUrl !== "string") return null;
    if (avatarUrl.startsWith(ASSET_HOST)) {
      return avatarUrl.slice(ASSET_HOST.length);
    }
    return avatarUrl;
  }
  function buildExportableReportPayload() {
    if (!engineState.lastReportData || !Array.isArray(engineState.lastReportData.logs)) {
      return null;
    }
    const raw = engineState.lastReportData;
    const hasPlayers = Array.isArray(raw.participants?.players) && raw.participants.players.length > 0;
    const hasEnemies = Array.isArray(raw.participants?.enemies) && raw.participants.enemies.length > 0;
    let participants = raw.participants ? structuredClone(raw.participants) : { players: [], enemies: [] };
    if (!hasPlayers && !hasEnemies && engineState.actors.size > 0) {
      const players = [];
      const enemies = [];
      engineState.actors.forEach((actor) => {
        const entry = {
          userId: actor.id,
          characterName: actor.name,
          summonerId: actor.ownerId || void 0,
          imagePath: toSerializableImagePath(actor.avatar),
          stats: {
            hp: actor.hideHp ? 1 : actor.maxHp
          }
        };
        if (actor.side === "left") players.push(entry);
        else enemies.push(entry);
      });
      participants = { players, enemies };
    }
    return {
      ...raw,
      result: raw.result || engineState.battleResult || "WIN",
      participants,
      _mdbvMeta: {
        exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
        totalTurns: engineState.totalTurns,
        frameCount: engineState.frames.length
      }
    };
  }
  function exportCurrentBattleReport() {
    const payload = buildExportableReportPayload();
    if (!payload) {
      alert("\u76EE\u524D\u6C92\u6709\u53EF\u532F\u51FA\u7684\u6230\u5831\u8CC7\u6599\uFF01");
      return false;
    }
    let leftRep = "Player";
    let rightRep = "Enemy";
    for (const actor of engineState.actors.values()) {
      if (!actor.isSummon && actor.side === "left" && leftRep === "Player") {
        leftRep = actor.name;
      } else if (!actor.isSummon && actor.side === "right" && rightRep === "Enemy") {
        rightRep = actor.name;
      }
    }
    const now = /* @__PURE__ */ new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const filename = `mdbattle-${sanitizeFilenameSegment(leftRep)}-vs-${sanitizeFilenameSegment(rightRep)}-${timestamp}.json`;
    const jsonString = JSON.stringify(payload, null, 2);
    const blob = new Blob([jsonString], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2e3);
    return true;
  }
  function parseImportedReportText(rawText) {
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      throw new Error("\u6A94\u6848\u4E0D\u662F\u6709\u6548\u7684 JSON \u683C\u5F0F\u3002");
    }
    const battlePayload = extractBattlePayload(parsed);
    if (!battlePayload) {
      throw new Error("\u627E\u4E0D\u5230\u6709\u6548\u7684\u6230\u9B25\u7D00\u9304 (\u7F3A\u5C11 logs \u9663\u5217)\u3002");
    }
    return battlePayload;
  }
  function promptImportBattleReport(onReportLoaded) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.style.display = "none";
    input.onchange = async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;
      try {
        const text = await file.text();
        const payload = parseImportedReportText(text);
        onReportLoaded(payload);
      } catch (err) {
        alert(`\u8F09\u5165\u6230\u5831\u5931\u6557\uFF1A${err.message || "\u672A\u77E5\u932F\u8AA4"}`);
      }
    };
    document.body.appendChild(input);
    input.click();
  }

  // src/stage.js
  function formatSeekLabelText(frameIndex) {
    const total = engineState.frames.length;
    if (total === 0) return "0 / 0";
    return `${Math.min(frameIndex, total)} / ${total}`;
  }
  function closeBattleStage() {
    if (engineState.activeKeydownHandler) {
      window.removeEventListener("keydown", engineState.activeKeydownHandler);
      engineState.activeKeydownHandler = null;
    }
    engineState.isPlaying = false;
    engineState.timeScale = 1;
    nextPlaybackToken();
    releaseSpoilerGuard();
    if (engineState.hostElement) {
      engineState.hostElement.remove();
      engineState.hostElement = null;
    }
    document.querySelectorAll(`[data-mdbv-hidden-host], ${HOST_CONTENT_SELECTOR}`).forEach((el) => {
      el.style.display = "";
      el.removeAttribute("data-mdbv-hidden-host");
    });
  }
  function createBattleStage() {
    if (engineState.activeKeydownHandler) {
      window.removeEventListener("keydown", engineState.activeKeydownHandler);
      engineState.activeKeydownHandler = null;
    }
    if (engineState.hostElement) engineState.hostElement.remove();
    const host = document.createElement("div");
    host.id = "mdbv-host";
    host.style.cssText = "position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 2147483647; background: #000;";
    document.body.appendChild(host);
    engineState.hostElement = host;
    engineState.shadowRoot = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STAGE_STYLES;
    engineState.shadowRoot.appendChild(style);
    const stage = document.createElement("div");
    stage.className = "stage";
    const controls = document.createElement("div");
    controls.className = "controls";
    const playBtn = document.createElement("button");
    playBtn.id = "btn-play";
    playBtn.textContent = "\u66AB\u505C";
    const seekContainer = document.createElement("div");
    seekContainer.className = "seek-container";
    const seekLabel = document.createElement("span");
    seekLabel.id = "seek-label";
    seekLabel.textContent = formatSeekLabelText(0);
    const seekTrackWrapper = document.createElement("div");
    seekTrackWrapper.className = "seek-track-wrapper";
    const seekRange = document.createElement("input");
    seekRange.type = "range";
    seekRange.id = "seek-range";
    seekRange.min = 0;
    seekRange.max = Math.max(0, engineState.frames.length - 1);
    seekRange.value = 0;
    const seekMarkersLayer = document.createElement("div");
    seekMarkersLayer.className = "seek-markers-layer";
    const jumpToFrame = (targetIdx) => {
      if (engineState.frames.length === 0) return;
      const clamped = Math.max(0, Math.min(targetIdx, engineState.frames.length - 1));
      engineState.isPlaying = false;
      nextPlaybackToken();
      engineState.currentFrameIndex = clamped;
      playBtn.textContent = "\u64AD\u653E";
      seekRange.value = clamped;
      seekLabel.textContent = formatSeekLabelText(clamped);
      syncStageToAbsoluteState(clamped, false, true);
    };
    const jumpPrevTurn = () => {
      if (engineState.frames.length === 0) return;
      const curIdx = Math.max(0, Math.min(engineState.currentFrameIndex, engineState.frames.length - 1));
      const curTurn = engineState.frames[curIdx]?.turnNumber ?? 1;
      let firstOfCurrentTurn = curIdx;
      while (firstOfCurrentTurn > 0 && engineState.frames[firstOfCurrentTurn - 1]?.turnNumber === curTurn) {
        firstOfCurrentTurn--;
      }
      if (curIdx > firstOfCurrentTurn) {
        jumpToFrame(firstOfCurrentTurn);
        return;
      }
      const prevIdx = Math.max(0, firstOfCurrentTurn - 1);
      const prevTurn = engineState.frames[prevIdx]?.turnNumber ?? 0;
      let firstOfPrevTurn = prevIdx;
      while (firstOfPrevTurn > 0 && engineState.frames[firstOfPrevTurn - 1]?.turnNumber === prevTurn) {
        firstOfPrevTurn--;
      }
      jumpToFrame(firstOfPrevTurn);
    };
    const jumpNextTurn = () => {
      if (engineState.frames.length === 0) return;
      const curIdx = Math.max(0, Math.min(engineState.currentFrameIndex, engineState.frames.length - 1));
      const curTurn = engineState.frames[curIdx]?.turnNumber ?? 0;
      let nextIdx = curIdx + 1;
      while (nextIdx < engineState.frames.length && engineState.frames[nextIdx]?.turnNumber <= curTurn) {
        nextIdx++;
      }
      jumpToFrame(Math.min(nextIdx, engineState.frames.length - 1));
    };
    const maxFrameIdx = Math.max(1, engineState.frames.length - 1);
    const timelineMarkers = extractTimelineMarkers(engineState.frames);
    timelineMarkers.forEach((marker) => {
      const pin = document.createElement("div");
      pin.className = `seek-pin pin-${marker.category}`;
      const pct = Math.max(0, Math.min(100, marker.frameIndex / maxFrameIdx * 100));
      pin.style.left = `${pct}%`;
      const tooltip = document.createElement("div");
      tooltip.className = "seek-pin-tooltip";
      if (pct < 15) tooltip.classList.add("tooltip-align-left");
      else if (pct > 85) tooltip.classList.add("tooltip-align-right");
      const titleEl = document.createElement("span");
      titleEl.className = "seek-pin-tooltip-title";
      titleEl.textContent = `T${marker.turnNumber} (#${marker.frameIndex + 1}) \uFF5C ${marker.title}`;
      tooltip.appendChild(titleEl);
      if (marker.detail) {
        const detailEl = document.createElement("span");
        detailEl.className = "seek-pin-tooltip-detail";
        detailEl.textContent = marker.detail;
        tooltip.appendChild(detailEl);
      }
      pin.appendChild(tooltip);
      pin.onclick = (e) => {
        e.stopPropagation();
        jumpToFrame(marker.frameIndex);
      };
      seekMarkersLayer.appendChild(pin);
    });
    seekTrackWrapper.appendChild(seekRange);
    seekTrackWrapper.appendChild(seekMarkersLayer);
    playBtn.onclick = () => {
      if (!engineState.isPlaying) {
        if (engineState.currentFrameIndex === 0 || engineState.currentFrameIndex >= engineState.frames.length) {
          engineState.currentFrameIndex = 0;
          armSpoilerGuard(0);
          syncStageToAbsoluteState(0, true, false);
        } else {
          syncStageToAbsoluteState(engineState.currentFrameIndex, false, false);
        }
        engineState.isPlaying = true;
        playBtn.textContent = "\u66AB\u505C";
        const token2 = nextPlaybackToken();
        playbackLoop(token2);
      } else {
        engineState.isPlaying = false;
        nextPlaybackToken();
        playBtn.textContent = "\u64AD\u653E";
        syncStageToAbsoluteState(engineState.currentFrameIndex, false, true);
      }
    };
    const speedBtn = document.createElement("button");
    speedBtn.id = "btn-speed";
    speedBtn.textContent = `\u901F\u5EA6: ${engineState.playbackSpeed}x`;
    speedBtn.onclick = () => {
      const currentIdx = PLAYBACK_SPEEDS.indexOf(engineState.playbackSpeed);
      const nextIndex = (currentIdx === -1 ? 0 : currentIdx + 1) % PLAYBACK_SPEEDS.length;
      const nextSpeed = setPlaybackSpeed(PLAYBACK_SPEEDS[nextIndex]);
      speedBtn.textContent = `\u901F\u5EA6: ${nextSpeed}x`;
    };
    seekRange.oninput = (e) => {
      const targetFrame = Number(e.target.value);
      engineState.currentFrameIndex = targetFrame;
      seekLabel.textContent = formatSeekLabelText(targetFrame);
      engineState.currentCombo = createEmptyCombo();
      const token2 = nextPlaybackToken();
      if (engineState.isPlaying) {
        syncStageToAbsoluteState(targetFrame, false, false);
        playbackLoop(token2);
      } else {
        if (playBtn.textContent === "\u91CD\u65B0\u64AD\u653E") {
          playBtn.textContent = "\u64AD\u653E";
        }
        syncStageToAbsoluteState(targetFrame, false, true);
      }
    };
    seekContainer.appendChild(seekTrackWrapper);
    seekContainer.appendChild(seekLabel);
    const skipBtn = document.createElement("button");
    skipBtn.id = "btn-skip";
    skipBtn.className = "btn-skip";
    skipBtn.textContent = "\u8DF3\u904E";
    skipBtn.onclick = () => {
      engineState.isPlaying = false;
      engineState.timeScale = 1;
      nextPlaybackToken();
      const finalIdx = Math.max(0, engineState.frames.length - 1);
      engineState.currentFrameIndex = engineState.frames.length;
      seekRange.value = finalIdx;
      seekLabel.textContent = formatSeekLabelText(engineState.frames.length);
      syncStageToAbsoluteState(finalIdx, false, false);
      releaseSpoilerGuard();
      playBtn.textContent = "\u91CD\u65B0\u64AD\u653E";
      showMVPPanel();
    };
    controls.appendChild(playBtn);
    controls.appendChild(speedBtn);
    controls.appendChild(seekContainer);
    controls.appendChild(skipBtn);
    const ctbBox = document.createElement("div");
    ctbBox.className = "ctb-container";
    ctbBox.innerHTML = `
        <div class="ctb-track" id="ctb-track">
            <div class="ctb-action-point">ACTION</div>
        </div>
    `;
    const arena = document.createElement("div");
    arena.className = "arena";
    arena.id = "arena";
    const leftTeam = document.createElement("div");
    leftTeam.className = "team left-team";
    const rightTeam = document.createElement("div");
    rightTeam.className = "team right-team";
    engineState.actors.forEach((actor) => {
      const el = document.createElement("div");
      const unspawnedClass = actor.initiallySpawned === false ? "unspawned" : "";
      el.className = `actor ${actor.side} ${unspawnedClass}`.trim();
      el.id = `actor-${actor.id}`;
      const hpContainerStyle = actor.hideHp ? ' style="display: none;"' : "";
      const hpTextContent = actor.hideHp ? "" : `${actor.maxHp}/${actor.maxHp}`;
      el.innerHTML = `
            <div class="actor-name">${escapeHtml(actor.name)}</div>
            <div class="avatar-wrapper">
                <img class="avatar" src="${escapeHtml(actor.avatar)}" onerror="this.src='${DEFAULT_AVATAR_URL}'">
            </div>
            <div class="hp-container"${hpContainerStyle}>
                <div class="hp-fill" id="hp-fill-${escapeHtml(actor.id)}"></div>
                <div class="hp-text" id="hp-text-${escapeHtml(actor.id)}">${hpTextContent}</div>
            </div>
        `;
      if (actor.side === "left") leftTeam.appendChild(el);
      else rightTeam.appendChild(el);
    });
    arena.appendChild(leftTeam);
    arena.appendChild(rightTeam);
    const dialogBox = document.createElement("div");
    dialogBox.className = "dialog-box";
    dialogBox.id = "dialog-box";
    dialogBox.addEventListener("click", (e) => {
      const selection = window.getSelection ? window.getSelection() : null;
      if (selection && selection.toString().trim().length > 0) return;
      const lineEl = e.target.closest(".log-line[data-frame-index]");
      if (!lineEl) return;
      const targetFrame = Number(lineEl.dataset.frameIndex);
      if (Number.isFinite(targetFrame)) {
        if (!engineState.isPlaying && engineState.currentFrameIndex === targetFrame) return;
        jumpToFrame(targetFrame);
      }
    });
    const fatalityOverlay = document.createElement("div");
    fatalityOverlay.id = "fatality-overlay";
    fatalityOverlay.className = "fatality-overlay";
    const dragDropOverlay = document.createElement("div");
    dragDropOverlay.className = "drag-drop-overlay";
    dragDropOverlay.innerHTML = `
        <div class="drag-drop-box">
            <div class="drag-drop-title">\u653E\u958B\u4EE5\u8F09\u5165\u6230\u5831 JSON</div>
            <div class="drag-drop-sub">\u652F\u63F4\u532F\u51FA\u7684 .json \u6230\u5831\u5099\u4EFD\u6A94\u6216\u539F\u59CB API JSON</div>
        </div>
    `;
    stage.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      dragDropOverlay.classList.add("active");
    });
    stage.addEventListener("dragleave", (e) => {
      if (!stage.contains(e.relatedTarget)) {
        dragDropOverlay.classList.remove("active");
      }
    });
    stage.addEventListener("drop", async (e) => {
      e.preventDefault();
      dragDropOverlay.classList.remove("active");
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = parseImportedReportText(text);
        if (typeof engineState.onImportReport === "function") {
          await engineState.onImportReport(parsed);
        }
      } catch (err) {
        alert(`\u6230\u5831\u62D6\u66F3\u8F09\u5165\u5931\u6557\uFF1A${err.message || "\u6A94\u6848\u683C\u5F0F\u932F\u8AA4"}`);
      }
    });
    stage.appendChild(controls);
    stage.appendChild(ctbBox);
    stage.appendChild(arena);
    stage.appendChild(dialogBox);
    stage.appendChild(fatalityOverlay);
    stage.appendChild(dragDropOverlay);
    engineState.shadowRoot.appendChild(stage);
    const handleKeydown = (e) => {
      if (!engineState.hostElement || !engineState.hostElement.isConnected) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const activeTag = document.activeElement?.tagName;
      if (activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT") return;
      switch (e.key) {
        case " ":
          e.preventDefault();
          playBtn.click();
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (e.shiftKey) jumpPrevTurn();
          else jumpToFrame(engineState.currentFrameIndex - 1);
          break;
        case "ArrowRight":
          e.preventDefault();
          if (e.shiftKey) jumpNextTurn();
          else jumpToFrame(engineState.currentFrameIndex + 1);
          break;
        case "ArrowUp":
          e.preventDefault();
          jumpPrevTurn();
          break;
        case "ArrowDown":
          e.preventDefault();
          jumpNextTurn();
          break;
        case "1":
        case "2":
        case "3":
        case "4": {
          e.preventDefault();
          const idx = Number(e.key) - 1;
          if (idx >= 0 && idx < PLAYBACK_SPEEDS.length) {
            const nextSpeed = setPlaybackSpeed(PLAYBACK_SPEEDS[idx]);
            speedBtn.textContent = `\u901F\u5EA6: ${nextSpeed}x`;
          }
          break;
        }
        case "s":
        case "S":
          e.preventDefault();
          skipBtn.click();
          break;
        case "e":
        case "E":
          e.preventDefault();
          exportCurrentBattleReport();
          break;
        case "o":
        case "O":
          e.preventDefault();
          if (typeof engineState.onImportReport === "function") {
            promptImportBattleReport(engineState.onImportReport);
          }
          break;
        case "Escape":
          e.preventDefault();
          closeBattleStage();
          break;
        default:
          break;
      }
    };
    engineState.activeKeydownHandler = handleKeydown;
    window.addEventListener("keydown", handleKeydown);
    const originalContent = document.querySelector(HOST_CONTENT_SELECTOR);
    if (originalContent) {
      originalContent.setAttribute("data-mdbv-hidden-host", "true");
      originalContent.style.display = "none";
    }
    engineState.isPlaying = true;
    updateATBUI(0, true);
    const token = nextPlaybackToken();
    playbackLoop(token);
  }
  function collectAOEWaveBatch(startIndex) {
    const first = engineState.frames[startIndex];
    if (!first || !first.isAOE || first.isCounter || first.type === "COUNTER" || !["DAMAGE", "MISS", "BLOCK"].includes(first.type)) {
      return [];
    }
    const casterId = first.aoeCasterId || first.actorId;
    const batch = [first];
    let idx = startIndex + 1;
    while (idx < engineState.frames.length) {
      const cur = engineState.frames[idx];
      if (cur && cur.isAOE && !cur.isCounter && cur.type !== "COUNTER" && ["DAMAGE", "MISS", "BLOCK"].includes(cur.type) && (cur.aoeCasterId || cur.actorId) === casterId) {
        batch.push(cur);
        if (cur.isAOELast) break;
        idx++;
      } else {
        break;
      }
    }
    return batch;
  }
  async function renderAOEWaveBatch(waveFrames, token) {
    const sr = engineState.shadowRoot;
    if (!sr || engineState.playbackToken !== token || waveFrames.length === 0) return;
    const arena = sr.getElementById("arena");
    const dialog = sr.getElementById("dialog-box");
    const firstFrame = waveFrames[0];
    if (isPrimaryUltimateTriggerFrame(firstFrame)) {
      const actor = engineState.actors.get(firstFrame.actorId);
      const isMultiHitSubFrame = ULTIMATE_SUBFRAME_REGEX.test(firstFrame.message.trim()) || firstFrame.rosarioEvent === "INSCRIBE_CROSS";
      if (actor && actor.lastUltimateTurn !== firstFrame.turnNumber && !isMultiHitSubFrame) {
        actor.lastUltimateTurn = firstFrame.turnNumber;
        await playUltimateCutIn(firstFrame, sr, token);
        if (engineState.playbackToken !== token) return;
      } else if (actor && isMultiHitSubFrame) {
        actor.lastUltimateTurn = firstFrame.turnNumber;
      }
    }
    updateATBUI(firstFrame.turnNumber, false, firstFrame.actorsSummonState);
    syncActorBondVisuals(sr, firstFrame.actorsBondState);
    const { staggerMs, impactDelayMs, totalDurationMs, shadowColor } = playAOEWaveBatchChoreography(waveFrames, sr);
    const hasCritShake = waveFrames.some((wf) => wf.vfx.includes("screen-shake"));
    if (hasCritShake && arena) {
      setTimeout(() => {
        if (engineState.playbackToken === token && arena.isConnected) {
          arena.classList.remove("shake-active");
          void arena.offsetWidth;
          arena.classList.add("shake-active");
        }
      }, impactDelayMs / getEffectiveSpeed());
    }
    const waveDeadActorIds = new Set(
      waveFrames.filter((wf) => wf.isDeathEvent && wf.deadActorId).map((wf) => wf.deadActorId)
    );
    waveFrames.forEach((wf, idx) => {
      const hitDelay = (impactDelayMs + idx * staggerMs) / getEffectiveSpeed();
      setTimeout(() => {
        if (engineState.playbackToken !== token || !engineState.hostElement?.isConnected) return;
        if (wf.message && dialog) {
          if (dialog.lastElementChild?.dataset?.frameIndex !== String(wf.index)) {
            const msgEl = createLogLineElement(wf);
            dialog.appendChild(msgEl);
            dialog.scrollTop = dialog.scrollHeight;
          }
        }
        const speed = getEffectiveSpeed();
        const lookahead = lookaheadComboState(wf.index, wf);
        advanceComboState(wf, lookahead.isNextFrameSameCombo);
        renderComboBanner(arena, wf, speed);
        const targetEl = wf.targetId ? sr.getElementById(`actor-${wf.targetId}`) : null;
        const targetSide = engineState.actors.get(wf.targetId)?.side || "right";
        if (targetEl && arena) {
          triggerAOETargetImpact(wf, arena, targetEl, targetSide, shadowColor, speed);
          if (wf.vfx.includes("dodge-blink")) {
            targetEl.classList.add("blink-active");
            setTimeout(() => {
              if (engineState.playbackToken === token && targetEl.isConnected) {
                targetEl.classList.remove("blink-active");
              }
            }, 300 / speed);
          }
        }
        spawnFloatingText(wf, sr, lookahead.isNextFrameSameCombo, lookahead.isNextTargetDifferent);
        syncActorHpAndDeathDOM(sr, wf, {
          skipHpTransition: false,
          syncSummonVisibility: false,
          deferDeadClassForActorId: waveDeadActorIds
        });
      }, hitDelay);
    });
    await new Promise((resolve) => setTimeout(resolve, totalDurationMs / getEffectiveSpeed()));
    if (engineState.playbackToken !== token) return;
    for (const wf of waveFrames) {
      if (wf.isDeathEvent && wf.deadActorId) {
        await playFatalitySequence(sr, wf.deadActorId, token);
        if (engineState.playbackToken !== token) return;
        const deadWrapper = sr.getElementById(`actor-${wf.deadActorId}`);
        if (deadWrapper) {
          deadWrapper.classList.add("dead");
        }
      }
    }
  }
  async function playbackLoop(token) {
    while (engineState.currentFrameIndex < engineState.frames.length && engineState.isPlaying && engineState.playbackToken === token) {
      const aoeBatch = collectAOEWaveBatch(engineState.currentFrameIndex);
      if (aoeBatch.length >= 2) {
        await renderAOEWaveBatch(aoeBatch, token);
        if (engineState.playbackToken !== token || !engineState.isPlaying) {
          return;
        }
        engineState.currentFrameIndex += aoeBatch.length;
      } else {
        const frame = engineState.frames[engineState.currentFrameIndex];
        await renderFrame(frame, token);
        if (engineState.playbackToken !== token || !engineState.isPlaying) {
          return;
        }
        engineState.currentFrameIndex++;
      }
      const sr = engineState.shadowRoot;
      if (sr) {
        const seekRange = sr.getElementById("seek-range");
        const seekLabel = sr.getElementById("seek-label");
        if (seekRange) seekRange.value = Math.min(engineState.currentFrameIndex, engineState.frames.length - 1);
        if (seekLabel) seekLabel.textContent = formatSeekLabelText(engineState.currentFrameIndex);
      }
    }
    if (engineState.playbackToken === token && engineState.currentFrameIndex >= engineState.frames.length) {
      engineState.isPlaying = false;
      releaseSpoilerGuard();
      const sr = engineState.shadowRoot;
      if (sr) {
        const playBtn = sr.getElementById("btn-play");
        if (playBtn) playBtn.textContent = "\u91CD\u65B0\u64AD\u653E";
      }
      showMVPPanel();
      engineState.currentFrameIndex = 0;
    }
  }
  async function renderFrame(frame, token) {
    const sr = engineState.shadowRoot;
    if (!sr || engineState.playbackToken !== token) return;
    const arena = sr.getElementById("arena");
    const dialog = sr.getElementById("dialog-box");
    let frameDuration = 600;
    if (frame.message && dialog) {
      if (dialog.lastElementChild?.dataset?.frameIndex !== String(frame.index)) {
        const msgEl = createLogLineElement(frame);
        dialog.appendChild(msgEl);
        dialog.scrollTop = dialog.scrollHeight;
      }
    }
    if (frame.isSummonEvent && frame.summonedActorId) {
      const summonedEl = sr.getElementById(`actor-${frame.summonedActorId}`);
      if (summonedEl) {
        summonedEl.classList.remove("unspawned", "despawning");
        summonedEl.classList.add("spawning");
        setTimeout(() => {
          if (engineState.playbackToken === token && summonedEl.isConnected) {
            summonedEl.classList.remove("spawning");
          }
        }, 600 / getEffectiveSpeed());
      }
    }
    if (frame.isDespawnEvent && frame.despawnedActorId) {
      const despawnedEl = sr.getElementById(`actor-${frame.despawnedActorId}`);
      if (despawnedEl) {
        despawnedEl.classList.remove("spawning");
        despawnedEl.classList.add("despawning");
        setTimeout(() => {
          if (engineState.playbackToken === token && despawnedEl.isConnected) {
            despawnedEl.classList.remove("despawning");
            despawnedEl.classList.add("unspawned");
          }
        }, 450 / getEffectiveSpeed());
      }
    }
    const speaker = resolveDialogueSpeaker(frame);
    if (speaker) {
      const readTime = renderSpeechBubble(frame, sr, token);
      const textDuration = getMessageReadingDuration(speaker.quote);
      frameDuration = Math.max(frameDuration, textDuration, readTime);
    } else if (isSceneNarrationFrame(frame)) {
      const readTime = renderSceneNarrationBanner(frame, sr, token);
      const textDuration = getMessageReadingDuration(frame.message);
      frameDuration = Math.max(frameDuration, textDuration, readTime);
    }
    if (frame.isEnvironmentalPulse && frame.type === "TEXT") {
      playEnvironmentalFieldPulse(frame, sr);
      frameDuration = Math.max(frameDuration, 1100);
    }
    if (frame.diceCheck || ["FATIGUE", "FATIGUE_SKIP", "SILENCED"].includes(frame.type) || frame.type === "SKILL_TEXT" || frame.type === "TEXT") {
      spawnStatusOrDiceBadge(frame, sr);
    }
    updateATBUI(frame.turnNumber, false, frame.actorsSummonState);
    syncActorBondVisuals(sr, frame.actorsBondState);
    if (frame.contractEvent === "ACCEPT") {
      await playContractCutIn(frame, sr, token);
      if (engineState.playbackToken !== token) return;
      frameDuration = 450;
    }
    if (frame.rosarioEvent === "INSCRIBE_CROSS") {
      spawnRosarioCross(frame, sr);
      frameDuration = 520;
    }
    if (isPrimaryUltimateTriggerFrame(frame)) {
      const actor = engineState.actors.get(frame.actorId);
      const isMultiHitSubFrame = ULTIMATE_SUBFRAME_REGEX.test(frame.message.trim()) || frame.rosarioEvent === "INSCRIBE_CROSS";
      if (actor && actor.lastUltimateTurn !== frame.turnNumber && !isMultiHitSubFrame) {
        actor.lastUltimateTurn = frame.turnNumber;
        await playUltimateCutIn(frame, sr, token);
        if (engineState.playbackToken !== token) return;
      } else if (actor && isMultiHitSubFrame) {
        actor.lastUltimateTurn = frame.turnNumber;
      }
    }
    const {
      isNextFrameSameCombo,
      isNextTargetDifferent,
      shouldReturnToOrigin
    } = lookaheadComboState(engineState.currentFrameIndex, frame);
    if (frame.isCoverEvent) {
      frameDuration = playCoverAnimation(frame, sr);
    } else if (frame.actorId && ["DAMAGE", "MISS", "COUNTER", "BLOCK"].includes(frame.type)) {
      frameDuration = playCombatAnimation(
        frame,
        sr,
        isNextFrameSameCombo,
        isNextTargetDifferent,
        shouldReturnToOrigin
      );
    }
    if (frame.vfx.includes("screen-shake") && arena) {
      arena.classList.remove("shake-active");
      void arena.offsetWidth;
      arena.classList.add("shake-active");
      frameDuration = Math.max(frameDuration, 600);
    }
    if (frame.vfx.includes("dodge-blink") && frame.targetId) {
      const targetEl = sr.getElementById(`actor-${frame.targetId}`);
      if (targetEl) {
        targetEl.classList.add("blink-active");
        setTimeout(() => {
          if (engineState.playbackToken === token && targetEl.isConnected) {
            targetEl.classList.remove("blink-active");
          }
        }, 300 / getEffectiveSpeed());
      }
    }
    if (frame.targetId) {
      const targetEl = sr.getElementById(`actor-${frame.targetId}`);
      if (targetEl) {
        if (frame.vfx.includes("luck-drop")) {
          const dropEl = document.createElement("div");
          dropEl.className = "luck-drop";
          dropEl.textContent = getLuckDropEmoji(frame.message);
          targetEl.appendChild(dropEl);
          setTimeout(() => {
            if (dropEl.isConnected) dropEl.remove();
          }, 1e3 / getEffectiveSpeed());
          frameDuration = Math.max(frameDuration, 750);
        }
        if (frame.vfx.includes("break-stamp")) {
          const breakEl = document.createElement("div");
          breakEl.className = "break-stamp";
          breakEl.textContent = "BREAK!";
          targetEl.appendChild(breakEl);
          setTimeout(() => {
            if (breakEl.isConnected) breakEl.remove();
          }, 1200 / getEffectiveSpeed());
          frameDuration = 1e3;
        }
      }
    }
    spawnFloatingText(frame, sr, isNextFrameSameCombo, isNextTargetDifferent);
    const triggeredFatality = !!frame.isDeathEvent;
    const deadActorId = frame.isDeathEvent ? frame.deadActorId : null;
    syncActorHpAndDeathDOM(sr, frame, {
      skipHpTransition: false,
      syncSummonVisibility: false,
      deferDeadClassForActorId: triggeredFatality ? deadActorId : null
    });
    if (triggeredFatality && deadActorId) {
      await playFatalitySequence(sr, deadActorId, token);
      if (engineState.playbackToken !== token) return;
      const deadWrapper = sr.getElementById(`actor-${deadActorId}`);
      if (deadWrapper) {
        deadWrapper.classList.add("dead");
      }
    }
    const actualDelay = frameDuration / getEffectiveSpeed();
    await new Promise((resolve) => setTimeout(resolve, actualDelay));
  }

  // src/index.js
  var originalFetch = window.fetch.bind(window);
  var lastAutoLaunchedReportId = null;
  function findBattlePayload(obj, depth = 0) {
    return extractBattlePayload(obj, depth);
  }
  function hasValidParticipants(battleData) {
    const p = battleData?.participants;
    if (!p) return false;
    return Array.isArray(p.players) && p.players.length > 0 && p.players[0]?.stats?.hp != null;
  }
  async function prepareAndInitVisualizer(rawBattleData, { force = false } = {}) {
    const battleData = findBattlePayload(rawBattleData);
    if (!battleData) return false;
    const reportId = battleData.reportId != null ? String(battleData.reportId) : null;
    if (!force && reportId && reportId === lastAutoLaunchedReportId && engineState.hostElement) {
      return true;
    }
    if (reportId) {
      lastAutoLaunchedReportId = reportId;
    }
    let finalReportData = battleData;
    if (!hasValidParticipants(battleData) && reportId) {
      try {
        const token = localStorage.getItem("token");
        const headers = token ? { "Authorization": `Bearer ${token}` } : {};
        const res = await originalFetch(`${API_BASE}/api/battle-reports/${reportId}?_t=${Date.now()}`, {
          headers,
          cache: "no-store"
        });
        if (res.ok) {
          const fullData = await res.json();
          const fullBattle = findBattlePayload(fullData) || fullData;
          finalReportData = {
            ...battleData,
            ...fullBattle,
            participants: fullBattle.participants || battleData.participants,
            boss: fullBattle.boss || battleData.boss,
            logs: fullBattle.logs || battleData.logs
          };
        }
      } catch (err) {
        console.warn("Visualizer: Failed to fetch supplementary participant data, using fallback.", err);
      }
    }
    initVisualizer(finalReportData);
    return true;
  }
  function initVisualizer(reportData) {
    engineState.lastReportData = reportData;
    engineState.isPlaying = false;
    engineState.timeScale = 1;
    nextPlaybackToken();
    armSpoilerGuard(0);
    engineState.currentFrameIndex = 0;
    engineState.currentCombo = createEmptyCombo();
    engineState.floatTracker.clear();
    engineState.totalTurns = 0;
    engineState.battleResult = reportData.result || "WIN";
    parseParticipants(reportData);
    buildStateSnapshots(reportData.logs || []);
    engineState.actors.forEach((actor) => {
      actor.currentHp = actor.maxHp;
    });
    createBattleStage();
  }
  engineState.onImportReport = (payload) => {
    prepareAndInitVisualizer(payload, { force: true });
  };
  function createToggleButton() {
    if (!document.body || document.getElementById("mdbv-floating-dock")) return;
    if (!document.getElementById("mdbv-dock-styles")) {
      const style = document.createElement("style");
      style.id = "mdbv-dock-styles";
      style.textContent = `
            #mdbv-floating-dock {
                position: fixed;
                z-index: 9999;
                display: flex;
                flex-direction: column-reverse;
                align-items: flex-end;
                gap: 6px;
                padding: 4px;
                user-select: none;
                touch-action: none;
            }
            #mdbv-toggle-btn {
                background: #2c7a7b;
                color: white;
                border: 1px solid #4fd1c5;
                padding: 10px 16px;
                border-radius: 8px;
                cursor: pointer;
                font-weight: bold;
                box-shadow: 0 4px 10px rgba(0, 0, 0, 0.4);
                font-size: 13px;
                white-space: nowrap;
                transition: background 0.15s, transform 0.1s;
            }
            #mdbv-toggle-btn:hover {
                background: #319795;
            }
            #mdbv-toggle-btn:active {
                transform: scale(0.98);
            }
            .mdbv-dock-menu {
                display: flex;
                flex-direction: column;
                gap: 6px;
                opacity: 0;
                pointer-events: none;
                transform: translateY(6px);
                transition: opacity 0.18s ease, transform 0.18s ease;
                position: relative;
            }
            /* Seamless hover bridge: ensures cursor never leaves dock when moving between button and menu */
            .mdbv-dock-menu::after {
                content: '';
                position: absolute;
                left: 0;
                right: 0;
                top: 100%;
                height: 10px;
                pointer-events: auto;
            }
            #mdbv-floating-dock:hover .mdbv-dock-menu,
            #mdbv-floating-dock.menu-open .mdbv-dock-menu {
                opacity: 1;
                pointer-events: auto;
                transform: translateY(0);
            }
            .mdbv-menu-item-btn {
                background: #2b6cb0;
                color: white;
                border: 1px solid #63b3ed;
                padding: 8px 14px;
                border-radius: 6px;
                cursor: pointer;
                font-weight: bold;
                box-shadow: 0 4px 8px rgba(0, 0, 0, 0.35);
                font-size: 13px;
                white-space: nowrap;
                transition: background 0.15s, transform 0.1s;
                text-align: left;
            }
            .mdbv-menu-item-btn:hover {
                background: #3182ce;
                transform: translateX(-2px);
            }
            .mdbv-menu-item-btn:active {
                transform: scale(0.98);
            }
        `;
      document.head.appendChild(style);
    }
    const dock = document.createElement("div");
    dock.id = "mdbv-floating-dock";
    const menu = document.createElement("div");
    menu.className = "mdbv-dock-menu";
    const importBtn = document.createElement("button");
    importBtn.id = "mdbv-import-btn";
    importBtn.className = "mdbv-menu-item-btn";
    importBtn.textContent = "\u8F09\u5165\u6230\u5831";
    importBtn.title = "\u5F9E\u96FB\u8166\u8F09\u5165\u5DF2\u4FDD\u5B58\u7684 .json \u6230\u5831\u6A94\u6848\u9032\u884C\u96E2\u7DDA\u91CD\u64AD";
    importBtn.onclick = (e) => {
      e.stopPropagation();
      dock.classList.remove("menu-open");
      promptImportBattleReport((payload) => {
        prepareAndInitVisualizer(payload, { force: true });
      });
    };
    const exportBtn = document.createElement("button");
    exportBtn.id = "mdbv-export-btn";
    exportBtn.className = "mdbv-menu-item-btn";
    exportBtn.textContent = "\u532F\u51FA\u6230\u5831";
    exportBtn.title = "\u5C07\u7576\u524D\u6230\u5831\u6253\u5305\u70BA .json \u6A94\u6848\u6C38\u4E45\u4FDD\u5B58\u81F3\u672C\u6A5F";
    exportBtn.onclick = (e) => {
      e.stopPropagation();
      dock.classList.remove("menu-open");
      if (!engineState.lastReportData) {
        alert("\u76EE\u524D\u5C1A\u7121\u53EF\u532F\u51FA\u7684\u6230\u5831\u8CC7\u6599\uFF01\u8ACB\u5148\u9032\u5165\u6230\u5831\u9801\u9762\u6216\u9032\u884C\u4E00\u5834\u6230\u9B25\u3002");
        return;
      }
      exportCurrentBattleReport();
    };
    menu.appendChild(importBtn);
    menu.appendChild(exportBtn);
    const mainBtn = document.createElement("button");
    mainBtn.id = "mdbv-toggle-btn";
    mainBtn.textContent = "\u555F\u52D5\u8996\u89BA\u5316\u6F14\u51FA";
    mainBtn.title = "\u9EDE\u64CA\u555F\u52D5\u8996\u89BA\u5316\u6230\u6CC1\u56DE\u653E (\u6309\u4F4F\u53EF\u62D6\u66F3\u8ABF\u6574\u4F4D\u7F6E)";
    mainBtn.onclick = async (e) => {
      if (didDrag) {
        e.stopPropagation();
        didDrag = false;
        return;
      }
      const match = location.pathname.match(/\/reports\/(\d+)/);
      if (match) {
        const reportId = match[1];
        mainBtn.textContent = "\u8F09\u5165\u4E2D...";
        try {
          const token = localStorage.getItem("token");
          const headers = token ? { "Authorization": `Bearer ${token}` } : {};
          const response = await originalFetch(`${API_BASE}/api/battle-reports/${reportId}?_t=${Date.now()}`, {
            headers,
            cache: "no-store"
          });
          if (response.ok) {
            const data = await response.json();
            const launched = await prepareAndInitVisualizer(data, { force: true });
            if (!launched) alert("\u7121\u6CD5\u89E3\u6790\u6230\u5831\u8CC7\u6599");
          } else {
            alert(`\u8B80\u53D6\u6230\u5831\u5931\u6557 (\u932F\u8AA4\u78BC: ${response.status})`);
          }
        } catch (err) {
          console.error("Visualizer error:", err);
          alert("\u9023\u7DDA\u932F\u8AA4\uFF1A\u5DF2\u88AB\u700F\u89BD\u5668\u6216\u4F3A\u670D\u5668\u963B\u64CB\uFF0C\u8ACB\u67E5\u770B F12 \u4E3B\u63A7\u53F0");
        } finally {
          mainBtn.textContent = "\u555F\u52D5\u8996\u89BA\u5316\u6F14\u51FA";
        }
      } else if (engineState.lastReportData) {
        initVisualizer(engineState.lastReportData);
      } else {
        alert("\u8ACB\u5148\u9032\u884C\u4E00\u5834\u6230\u9B25\u3001\u5728\u6230\u5831\u9801\u9762\u4F7F\u7528\uFF0C\u6216\u9EDE\u64CA\u300C\u8F09\u5165\u6230\u5831\u300D\u8B80\u53D6\u5DF2\u4FDD\u5B58\u7684 JSON \u6230\u5831\u6A94\uFF01");
      }
    };
    dock.appendChild(mainBtn);
    dock.appendChild(menu);
    document.body.appendChild(dock);
    const updateMenuOrientation = () => {
      const rect = dock.getBoundingClientRect();
      const isTopHalf = rect.top < 160;
      const isLeftHalf = rect.left < window.innerWidth / 2;
      dock.style.flexDirection = isTopHalf ? "column" : "column-reverse";
      dock.style.alignItems = isLeftHalf ? "flex-start" : "flex-end";
    };
    const savedPos = (() => {
      try {
        const raw = localStorage.getItem("mdbv_dock_pos");
        if (raw) return JSON.parse(raw);
      } catch {
      }
      return null;
    })();
    if (savedPos && typeof savedPos.left === "number" && typeof savedPos.top === "number") {
      const maxLeft = Math.max(8, window.innerWidth - 180);
      const maxTop = Math.max(8, window.innerHeight - 60);
      dock.style.left = `${Math.max(8, Math.min(maxLeft, savedPos.left))}px`;
      dock.style.top = `${Math.max(8, Math.min(maxTop, savedPos.top))}px`;
      dock.style.right = "auto";
      dock.style.bottom = "auto";
    } else {
      dock.style.right = "20px";
      dock.style.bottom = "20px";
    }
    updateMenuOrientation();
    let isDragging = false;
    let didDrag = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    const onPointerMove = (e) => {
      const clientX = e.clientX ?? e.touches?.[0]?.clientX;
      const clientY = e.clientY ?? e.touches?.[0]?.clientY;
      if (clientX == null || clientY == null) return;
      const dx = clientX - startX;
      const dy = clientY - startY;
      if (!isDragging && Math.hypot(dx, dy) > 5) {
        isDragging = true;
        didDrag = true;
        dock.classList.remove("menu-open");
      }
      if (isDragging) {
        const maxLeft = Math.max(8, window.innerWidth - dock.offsetWidth - 8);
        const maxTop = Math.max(8, window.innerHeight - dock.offsetHeight - 8);
        const nextLeft = Math.max(8, Math.min(maxLeft, startLeft + dx));
        const nextTop = Math.max(8, Math.min(maxTop, startTop + dy));
        dock.style.left = `${nextLeft}px`;
        dock.style.top = `${nextTop}px`;
        dock.style.right = "auto";
        dock.style.bottom = "auto";
        updateMenuOrientation();
      }
    };
    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      if (isDragging) {
        isDragging = false;
        try {
          localStorage.setItem("mdbv_dock_pos", JSON.stringify({
            left: parseInt(dock.style.left, 10),
            top: parseInt(dock.style.top, 10)
          }));
        } catch {
        }
      }
    };
    mainBtn.addEventListener("pointerdown", (e) => {
      if (e.button != null && e.button !== 0) return;
      const clientX = e.clientX ?? e.touches?.[0]?.clientX;
      const clientY = e.clientY ?? e.touches?.[0]?.clientY;
      if (clientX == null || clientY == null) return;
      isDragging = false;
      didDrag = false;
      startX = clientX;
      startY = clientY;
      const rect = dock.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    });
    window.addEventListener("resize", () => {
      const rect = dock.getBoundingClientRect();
      const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
      const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
      const nextLeft = Math.max(8, Math.min(maxLeft, rect.left));
      const nextTop = Math.max(8, Math.min(maxTop, rect.top));
      dock.style.left = `${nextLeft}px`;
      dock.style.top = `${nextTop}px`;
      dock.style.right = "auto";
      dock.style.bottom = "auto";
      updateMenuOrientation();
    });
  }
  function installFetchInterceptor() {
    window.fetch = async function(...args) {
      const input = args[0];
      const init = args[1];
      const url = typeof input === "string" ? input : input?.url || (input instanceof URL ? input.href : "");
      const method = String(init?.method || input?.method || "GET").toUpperCase();
      const isLiveBattlePost = method === "POST" && (/\/api\/dungeon\/challenge(?:[?#]|$)/.test(url) || /\/api\/players\/[^/]+\/[^/?#]+(?:[?#]|$)/.test(url));
      const isReportGet = method === "GET" && /\/api\/battle-reports\/\d+(?:[?#]|$)/.test(url);
      if (isLiveBattlePost) {
        lastAutoLaunchedReportId = null;
        armSpoilerGuard(45e3);
      }
      let response;
      try {
        response = await originalFetch(...args);
      } catch (err) {
        if (isLiveBattlePost) releaseSpoilerGuard();
        throw err;
      }
      try {
        if ((isLiveBattlePost || isReportGet) && response.ok) {
          const clonedResponse = response.clone();
          clonedResponse.json().then((data) => {
            const battlePayload = findBattlePayload(data);
            if (battlePayload) {
              prepareAndInitVisualizer(battlePayload);
            } else if (isLiveBattlePost) {
              releaseSpoilerGuard();
            }
          }).catch((e) => {
            console.error("Visualizer: JSON parse error", e);
            if (isLiveBattlePost) releaseSpoilerGuard();
          });
        } else if (isLiveBattlePost && !response.ok) {
          releaseSpoilerGuard();
        }
      } catch (e) {
        console.error("Visualizer: Fetch interception failed", e);
      }
      return response;
    };
  }
  initSpoilerObserver();
  installFetchInterceptor();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", createToggleButton);
  } else {
    createToggleButton();
  }
})();
