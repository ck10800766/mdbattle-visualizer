// ==UserScript==
// @name         MDBattle-Visualizer (Ultimate Edition V7.4)
// @namespace    mydoujin-battle-vfx
// @version      7.4.0
// @description  True ATB Timeline, live battle interception, anti-spoiler guard, and refined combat mechanics.
// @match        https://mydoujin.online/*
// @run-at       document-start
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ck10800766/mdbattle-visualizer/main/dist/mdbv.bundle.user.js
// @downloadURL  https://raw.githubusercontent.com/ck10800766/mdbattle-visualizer/main/dist/mdbv.bundle.user.js
// ==/UserScript==

(() => {
  // src/state.js
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
    playbackSpeed: 1,
    timeScale: 1,
    playbackToken: 0,
    currentCombo: createEmptyCombo(),
    floatTracker: /* @__PURE__ */ new Map(),
    shadowRoot: null,
    hostElement: null,
    actors: /* @__PURE__ */ new Map(),
    totalTurns: 0,
    battleResult: "WIN"
  };
  function getEffectiveSpeed() {
    return Math.max(0.05, engineState.playbackSpeed * engineState.timeScale);
  }
  function nextPlaybackToken() {
    engineState.playbackToken += 1;
    return engineState.playbackToken;
  }

  // src/profiles.js
  var KNOWN_AOE_SKILLS = /* @__PURE__ */ new Set([
    "genji_fan_of_blades",
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
  var ENVIRONMENTAL_SKILLS = /* @__PURE__ */ new Set([
    "originium_altar"
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
  var CONTRACT_SKILL_PROFILES = {
    kibayuki_trial_marriage: {
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
    }
  };
  var CROSS_FINISHER_PROFILES = {
    kibayuki_rosario: {
      inscribeRegex: /十字刻下了\s*(\d+)\s*道劍痕/,
      pierceRegex: /貫穿十字的正中央/,
      crossColor: "#f687b3",
      glowColor: "#b794f4"
    }
  };
  var SPECIAL_SKILL_BADGE_RULES = [
    {
      skillId: "kibayuki_demand",
      regex: /被罵得抬不起頭|出手都心虛了/,
      target: "target",
      text: () => "\u{1F4A6} \u5FC3\u865B",
      styleClass: "dice-warn",
      shakeTarget: true
    },
    {
      skillId: "kibayuki_zekken",
      regex: /接下這一劍，第\s*(\d+)\s*勝/,
      target: "actor",
      text: (m) => `\u2694\uFE0F \u7D55\u528D ${m[1]} \u52DD!`,
      styleClass: "dice-pass"
    },
    {
      skillId: "kibayuki_zekken",
      regex: /連勝停在第\s*(\d+)\s*勝/,
      target: "actor",
      text: (m) => `\u{1F494} \u9023\u52DD\u4E2D\u65B7 (${m[1]}\u52DD)`,
      styleClass: "dice-fail"
    }
  ];

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
      const searchLimit = firstPostRebirthDeltaIndex !== -1 ? firstPostRebirthDeltaIndex : anchorIndex;
      let rebirthFrameIndex = -1;
      for (let i = lowHpStartIndex + 1; i <= searchLimit; i++) {
        const f = frames[i];
        if (f.actorId === actor.id && ["TEXT", "BOSS_DIALOGUE", "SKILL_TEXT"].includes(f.type) && REBIRTH_RULES.dialogueRegex.test(f.message)) {
          rebirthFrameIndex = i;
          break;
        }
      }
      if (rebirthFrameIndex === -1) {
        for (let i = lowHpStartIndex + 1; i <= searchLimit; i++) {
          const f = frames[i];
          if (f.targetId === actor.id && f.type === "BLOCK" && f.message.includes(REBIRTH_RULES.blockKeyword)) {
            rebirthFrameIndex = i;
            break;
          }
        }
      }
      if (rebirthFrameIndex === -1) {
        rebirthFrameIndex = searchLimit;
      }
      const backwardHp = new Array(anchorIndex + 1);
      let currentBackHp = anchorHp;
      for (let i = anchorIndex; i >= rebirthFrameIndex; i--) {
        backwardHp[i] = currentBackHp;
        const delta = frames[i].hpDeltas?.get(actor.id) || 0;
        currentBackHp = Math.max(0, Math.min(actor.maxHp, currentBackHp - delta));
      }
      const prevHp = frames[Math.max(0, rebirthFrameIndex - 1)].actorsHpState.get(actor.id) ?? hpAtLowStart;
      const healedAmount = Math.round(backwardHp[rebirthFrameIndex] - prevHp);
      if (healedAmount > 0) {
        const rebirthFrame = frames[rebirthFrameIndex];
        rebirthFrame.rebirthHeal = true;
        rebirthFrame.isBeneficial = true;
        rebirthFrame.value = healedAmount;
        if (!rebirthFrame.vfx.includes("flash-green")) {
          rebirthFrame.vfx.push("flash-green");
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

  // src/parser.js
  var DEFAULT_AVATAR_URL = "https://via.placeholder.com/150";
  var ASSET_HOST = "https://mydoujin.online";
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
        avatar: avatarPath ? `${ASSET_HOST}${avatarPath}` : DEFAULT_AVATAR_URL,
        isSummon,
        ownerId: player.summonerId || null,
        initiallySpawned: !summonedIds.has(id)
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
        avatar: avatarPath ? `${ASSET_HOST}${avatarPath}` : DEFAULT_AVATAR_URL,
        isSummon,
        ownerId: enemy.summonerId || null,
        initiallySpawned: !summonedIds.has(id)
      }));
    });
    logs.forEach((log, index) => {
      if (!log || log.type !== "SUMMON" || !log.targetId) return;
      const owner = engineState.actors.get(log.actorId);
      const explicitHp = Number(log.maxHp || log.hp || log.stats?.hp);
      const hasExplicitHp = explicitHp > 1;
      const maxHp = hasExplicitHp ? explicitHp : 1;
      const summonName = inferSummonName(logs, index, log.targetId, owner?.name || "");
      if (!engineState.actors.has(log.targetId)) {
        engineState.actors.set(log.targetId, createActorEntity({
          id: log.targetId,
          name: summonName,
          side: owner ? owner.side : "left",
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
  function buildStateSnapshots(logs) {
    engineState.frames = [];
    let currentTurn = 0;
    let lastTurnActorId = null;
    const buffSrc = {};
    const applyLog = [];
    const actorsDeathState = /* @__PURE__ */ new Map();
    const actorsSummonState = /* @__PURE__ */ new Map();
    const actorsBondState = /* @__PURE__ */ new Map();
    const contractCutInCount = /* @__PURE__ */ new Map();
    engineState.actors.forEach((actor) => {
      actorsSummonState.set(actor.id, actor.initiallySpawned !== false);
    });
    logs.forEach((log, index) => {
      if (!log || typeof log !== "object") return;
      const rawValue = Number(log.value) || 0;
      const actualDamage = log.actualDamage != null ? Number(log.actualDamage) : rawValue;
      let isCounterSetup = false;
      if (log.type === "COUNTER") {
        for (let j = index + 1; j < Math.min(logs.length, index + 6); j++) {
          const nextLog = logs[j];
          if (nextLog && (nextLog.type === "DAMAGE" || nextLog.type === "BLOCK") && nextLog.isCounter && (Number(nextLog.value) === rawValue || nextLog.actorId === log.actorId)) {
            isCounterSetup = true;
            break;
          }
        }
      }
      const isSelfDamage = log.type === "DAMAGE" && log.actorId && log.actorId === log.targetId;
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
      let isTurnAction = false;
      if (["SKILL_TEXT", "BOSS_DIALOGUE"].includes(frame.type)) {
        isTurnAction = true;
      } else if (["DAMAGE", "MISS", "BLOCK"].includes(frame.type) && !frame.isCounter && !frame.isSelfDamage && !frame.isEnvironmentalPulse && frame.source !== "DIRECT") {
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
      if (log.type === "SUMMON" && log.targetId) {
        const owner = engineState.actors.get(log.actorId);
        const explicitHp = Number(log.maxHp || log.hp || log.stats?.hp);
        const hasExplicitHp = explicitHp > 1;
        const maxHp = hasExplicitHp ? explicitHp : 1;
        const summonName = inferSummonName(logs, index, log.targetId, owner?.name || "");
        if (!engineState.actors.has(log.targetId)) {
          engineState.actors.set(log.targetId, createActorEntity({
            id: log.targetId,
            name: summonName,
            side: owner ? owner.side : "left",
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
      if (log.type === "BUFF_APPLY") {
        const attacker = engineState.actors.get(log.actorId);
        const victim = engineState.actors.get(log.targetId);
        if (attacker && victim && attacker.side !== victim.side) {
          if (!buffSrc[victim.id]) buffSrc[victim.id] = {};
          buffSrc[victim.id][log.buffId || log.skillId || ""] = attacker.id;
          applyLog.push({ victim: victim.id, actor: attacker.id, msg: String(log.message || "") });
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
        if (frame.actionCancelled) frame.vfx.push("break-stamp");
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
      } else if (log.type === "HP_REMAINING") {
        const target = engineState.actors.get(log.actorId);
        if (target && log.maxHp) {
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
          }
          const lossMatch = msg.match(/失去了\s*(\d+)\s*(?:HP|點生命)/);
          if (lossMatch) {
            const amount = Number(lossMatch[1]);
            target.currentHp = Math.max(0, target.currentHp - amount);
            addHpDelta(target.id, -amount);
          }
        }
        const contractProfile = CONTRACT_SKILL_PROFILES[frame.skillId];
        if (contractProfile && log.type === "SKILL_TEXT") {
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
        const crossProfile2 = CROSS_FINISHER_PROFILES[frame.skillId];
        if (crossProfile2 && log.type === "SKILL_TEXT" && crossProfile2.inscribeRegex.test(msg)) {
          frame.rosarioEvent = "INSCRIBE_CROSS";
        }
      }
      const crossProfile = CROSS_FINISHER_PROFILES[frame.skillId];
      if (crossProfile && log.type === "DAMAGE" && crossProfile.pierceRegex.test(frame.message)) {
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
            totalTaken: 0
          });
        }
        const stats = consolidated.get(targetId);
        stats.totalOutput += (actor.totalDamageDealt || 0) + (actor.luckDamageDealt || 0);
        stats.totalTaken += actor.totalDamageTaken || 0;
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

  // src/styles.js
  var STAGE_STYLES = `
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    .stage { width: 100%; height: 100%; display: flex; flex-direction: column; background: radial-gradient(circle at center, #1a202c 0%, #000 100%); }

    /* Playback Controls */
    .controls { display: flex; padding: 10px 20px; background: #171923; border-bottom: 1px solid #2d3748; gap: 15px; align-items: center; justify-content: center; }
    .seek-container { flex: 1; display: flex; align-items: center; gap: 10px; color: #a0aec0; font-size: 13px; font-variant-numeric: tabular-nums; }
    input[type="range"] { flex: 1; accent-color: #4fd1c5; cursor: pointer; }
    button { background: #2c7a7b; color: #fff; border: 1px solid #4fd1c5; padding: 6px 16px; border-radius: 4px; cursor: pointer; font-weight: bold; transition: background 0.2s; white-space: nowrap; }
    button:hover { background: #319795; }
    button.danger { background: #9b2c2c; border-color: #fc8181; }
    button.danger:hover { background: #c53030; }

    /* ATB / CTB Timeline Track */
    .ctb-container { height: 70px; background: rgba(0,0,0,0.8); border-bottom: 2px solid #4a5568; position: relative; padding: 0 80px 0 40px; display: flex; align-items: center; box-shadow: 0 4px 10px rgba(0,0,0,0.5); }
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
    .log-line { margin-bottom: 4px; padding: 4px 8px; border-radius: 4px; animation: slideInUp 0.2s ease-out forwards; opacity: 0; line-height: 1.5; }
    .log-line.system-log { background: rgba(255, 255, 255, 0.03); }
    .log-line.dialogue-log { background: rgba(79, 209, 197, 0.1); border-left: 3px solid #4fd1c5; color: #e2e8f0; font-weight: 500; }
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
    .ult-quote.lang-zh { font-size: clamp(30px, 7vh, 70px); text-orientation: upright; letter-spacing: 1vh; }
    .ult-quote.lang-en { font-size: clamp(24px, 6vh, 60px); text-orientation: mixed; letter-spacing: 4px; }
    .ult-flavor { display: inline-block; font-family: "Yu Mincho", "Noto Serif TC", "PMingLiU", serif; font-size: clamp(14px, 2.5vh, 22px); color: #e2e8f0; text-shadow: -2px 2px 4px #000; text-orientation: upright; letter-spacing: 0.5vh; animation: ult-stamp-delay 2.5s cubic-bezier(0.1, 1, 0.2, 1) forwards; }

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
    .contract-Portraits-layer { position: absolute; inset: 0; display: flex; align-items: center; justify-content: space-between; padding: 0 8vw; }
    .contract-cutin-overlay.solo-mode .contract-Portraits-layer { justify-content: center; }
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
    .rosario-line { position: absolute; width: 140%; height: 5px; background: linear-gradient(90deg, transparent, #fff, #f687b3, #fff, transparent); box-shadow: 0 0 14px #f687b3, 0 0 24px #b794f4; border-radius: 999px; }
    .rosario-line.line-1 { transform: rotate(38deg); animation: rosario-slash-in 0.22s ease-out forwards; }
    .rosario-line.line-2 { transform: rotate(-38deg); animation: rosario-slash-in 0.22s 0.08s ease-out backwards; }
    .rosario-core { width: 22px; height: 22px; border-radius: 50%; background: #fff; box-shadow: 0 0 20px #fff, 0 0 35px #f687b3; animation: rosario-core-pulse 0.4s infinite alternate; }
    .rosario-cross-mark.shatter { animation: rosario-shatter 0.4s ease-out forwards; }
    @keyframes rosario-slash-in { from { transform: scaleX(0) rotate(38deg); opacity: 0; } to { opacity: 1; } }
    @keyframes rosario-core-pulse { from { transform: scale(0.85); } to { transform: scale(1.35); } }
    @keyframes rosario-shatter { 0% { transform: scale(1); filter: brightness(2); opacity: 1; } 100% { transform: scale(2.1); filter: brightness(3) blur(4px); opacity: 0; } }
`;

  // src/cinematics.js
  async function playFatalitySequence(sr, actorId) {
    const overlay = sr.getElementById("fatality-overlay");
    const actorEl = sr.getElementById(`actor-${actorId}`);
    if (!overlay || !actorEl) return;
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
      overlay.classList.remove("active");
      setTimeout(() => {
        if (slash.isConnected) slash.remove();
        if (deathText.isConnected) deathText.remove();
      }, 1e3);
    } finally {
      engineState.timeScale = 1;
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
    const quoteMatch = frame.message.match(/「(.*?)」/);
    const remainingText = frame.message.replace(actor.name, "").replace(/[：:]?\s*「.*?」\s*/, " ").trim();
    if (quoteMatch && quoteMatch[1].length <= 15 && remainingText.length > 0) {
      mainText = quoteMatch[1];
      subText = remainingText;
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
      } else {
        let rawSkillId = frame.skillId || "ULTIMATE_SKILL";
        if (rawSkillId.includes("_")) {
          rawSkillId = rawSkillId.substring(rawSkillId.indexOf("_") + 1);
        }
        mainText = rawSkillId.replace(/_/g, " ").toUpperCase();
      }
      const escapedActorName = escapeRegExp(actor.name);
      let cleanMsg = frame.message.replace(new RegExp(`^${escapedActorName}[\uFF1A:]?\\s*(\u7684\\s*)?`), "");
      cleanMsg = cleanMsg.replace(/[，,]?\s*會心一擊！?/g, "");
      cleanMsg = cleanMsg.replace(/[，,]?\s*(對\s*.+?\s*)?造成了?\s*\d+\s*點(真實)?傷害！?/g, "");
      cleanMsg = cleanMsg.replace(/^[，,]\s*/, "").trim();
      if (cleanMsg.length > 0 && !/[。！!?.—]$/.test(cleanMsg)) {
        cleanMsg += "\u2026\u2026";
      }
      subText = cleanMsg;
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
  function renderSpeechBubble(frame, sr, token) {
    const actorEl = sr.getElementById(`actor-${frame.actorId}`);
    const actor = engineState.actors.get(frame.actorId);
    if (!actorEl || !actor) return 0;
    const existingBubble = actorEl.querySelector(".speech-bubble");
    if (existingBubble) existingBubble.remove();
    const bubble = document.createElement("div");
    bubble.className = `speech-bubble ${actor.side === "left" ? "left-bubble" : "right-bubble"}`;
    const textContent = frame.message.replace(/^.+?[：:]\s*/, "");
    const textSpan = document.createElement("span");
    textSpan.className = "typewriter-text";
    bubble.appendChild(textSpan);
    actorEl.appendChild(bubble);
    const textLength = textContent.length;
    const readTime = Math.max(2e3, 1e3 + textLength * 100);
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
      const profile = CONTRACT_SKILL_PROFILES[frame.skillId];
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
      if (frame.skillId === rule.skillId && frame.message) {
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
    const profile = CONTRACT_SKILL_PROFILES[frame.skillId];
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
    const portraitsHtml = isDual ? `
            <div class="contract-portrait left-partner">
                <img src="${actor.avatar}" onerror="this.src='https://via.placeholder.com/150'">
                <div class="contract-partner-name">${actor.name}</div>
            </div>
            <div class="contract-portrait right-partner">
                <img src="${partner.avatar}" onerror="this.src='https://via.placeholder.com/150'">
                <div class="contract-partner-name">${partner.name}</div>
            </div>
        ` : `
            <div class="contract-portrait solo-partner">
                <img src="${actor.avatar}" onerror="this.src='https://via.placeholder.com/150'">
                <div class="contract-partner-name">${actor.name}</div>
            </div>
        `;
    const headlineText = isDual ? `${actor.name} <span>${profile.badgeIcon}</span> ${partner.name}` : `${actor.name} <span>${profile.badgeIcon}</span> ${profile.badgeText}`;
    overlay.innerHTML = `
        <div class="contract-backdrop"></div>
        <div class="contract-Portraits-layer">${portraitsHtml}</div>
        <div class="sao-modal-card">
            <div class="sao-modal-header">${profile.systemTitle}</div>
            <div class="sao-modal-body">
                <div class="sao-modal-couple">${headlineText}</div>
                <div class="sao-modal-desc">${profile.systemSubtitle}</div>
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
    const targetEl = sr.getElementById(`actor-${targetId}`);
    if (!targetEl) return;
    const existing = targetEl.querySelector(".rosario-cross-mark");
    if (existing) existing.remove();
    const crossEl = document.createElement("div");
    crossEl.className = "rosario-cross-mark";
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

  // src/choreography.js
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
        if (lookahead.isCounter || lookahead.type === "COUNTER") continue;
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
    const displayDamage = frame.value || frame.actualDamage || 0;
    if (!frame.isCounter && frame.type !== "COUNTER") {
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
            actorId: frame.actorId,
            skillId: frame.skillId,
            targetId: frame.targetId,
            count: 1,
            totalDamage: displayDamage,
            targetDamages: { [frame.targetId]: displayDamage },
            targetHitCounts: { [frame.targetId]: 1 },
            knockedBack: false,
            keepAlive: false,
            targetChangedThisHit: false,
            moveX: void 0,
            deltaY: void 0,
            prevMoveX: 0,
            prevDeltaY: 0,
            aoeCenterX: void 0,
            aoeCenterY: void 0,
            atCenterStage: false,
            lastFrameIndex: frame.index
          };
        }
        engineState.currentCombo.lastFrameIndex = frame.index;
      }
      if (engineState.currentCombo.count > 1) {
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
    }
    const actorEl = sr.getElementById(`actor-${frame.actorId}`);
    const targetEl = frame.targetId ? sr.getElementById(`actor-${frame.targetId}`) : null;
    if (actorEl && targetEl) {
      const side = engineState.actors.get(frame.actorId)?.side || "left";
      const targetSide = engineState.actors.get(frame.targetId)?.side || "right";
      const shadowColor = side === "left" ? "#fc8181" : "#4fd1c5";
      const triggerClashSpark = (delay = 120, color = "#f6e05e") => {
        setTimeout(() => {
          if (!targetEl.isConnected || !arena.isConnected) return;
          const sparkEl = document.createElement("div");
          sparkEl.style.cssText = `position: absolute; width: 70px; height: 70px; background: radial-gradient(circle, #ffffff 20%, ${color} 50%, transparent 80%); border-radius: 50%; z-index: 20; transform: translate(-50%, -50%) scale(0); pointer-events: none; mix-blend-mode: screen; box-shadow: 0 0 20px ${color};`;
          const tRect = targetEl.getBoundingClientRect();
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
      };
      if (frame.isAOE) {
        if (actorEl.getAnimations) actorEl.getAnimations().forEach((anim) => anim.cancel());
        if (targetEl.getAnimations) targetEl.getAnimations().forEach((anim) => anim.cancel());
        const arenaRect = arena.getBoundingClientRect();
        if (frame.isCounter || frame.type === "COUNTER") {
          frameDuration = 520;
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
          triggerClashSpark(80, "#f6e05e");
          return frameDuration;
        }
        if (engineState.currentCombo.aoeCenterX === void 0 || frame.isAOEFirst) {
          const cleanActorRect = actorEl.getBoundingClientRect();
          engineState.currentCombo.aoeCenterX = arenaRect.left + arenaRect.width / 2 - (cleanActorRect.left + cleanActorRect.width / 2);
          engineState.currentCombo.aoeCenterY = arenaRect.top + arenaRect.height / 2 - (cleanActorRect.top + cleanActorRect.height / 2);
        }
        const cMoveX = engineState.currentCombo.aoeCenterX;
        const cDeltaY = engineState.currentCombo.aoeCenterY;
        const p02 = "translate(0px, 0px) scale(1)";
        const pCenter = `translate(${cMoveX}px, ${cDeltaY}px) scale(1.2)`;
        const pCenterPulse = `translate(${cMoveX}px, ${cDeltaY}px) scale(1.28)`;
        let actorKeyframes2 = [];
        const actorAnimConfig2 = { duration: 280 / speed, easing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)", fill: "none" };
        if (!engineState.currentCombo.atCenterStage && !frame.isAOELast) {
          frameDuration = 280;
          actorAnimConfig2.duration = 260 / speed;
          actorAnimConfig2.fill = "forwards";
          actorKeyframes2 = [
            { transform: p02, zIndex: 10 },
            { transform: pCenterPulse, filter: `drop-shadow(0 0 14px ${shadowColor})`, zIndex: 10, offset: 0.7 },
            { transform: pCenter, filter: `drop-shadow(0 0 10px ${shadowColor})`, zIndex: 10, offset: 1 }
          ];
          engineState.currentCombo.atCenterStage = true;
        } else if (engineState.currentCombo.atCenterStage && !frame.isAOELast) {
          frameDuration = 220;
          actorAnimConfig2.duration = 200 / speed;
          actorAnimConfig2.fill = "forwards";
          actorKeyframes2 = [
            { transform: pCenter, filter: `drop-shadow(0 0 10px ${shadowColor})`, zIndex: 10 },
            { transform: pCenterPulse, filter: `drop-shadow(0 0 16px ${shadowColor})`, zIndex: 10, offset: 0.45 },
            { transform: pCenter, filter: `drop-shadow(0 0 10px ${shadowColor})`, zIndex: 10, offset: 1 }
          ];
        } else {
          frameDuration = 400;
          actorAnimConfig2.duration = 380 / speed;
          actorAnimConfig2.fill = "none";
          const startTransform = engineState.currentCombo.atCenterStage ? pCenter : p02;
          actorKeyframes2 = [
            { transform: startTransform, zIndex: 10 },
            { transform: pCenterPulse, filter: `drop-shadow(0 0 16px ${shadowColor})`, zIndex: 10, offset: 0.35 },
            { transform: p02, filter: "none", zIndex: 1, offset: 1 }
          ];
          engineState.currentCombo.atCenterStage = false;
          engineState.currentCombo.knockedBack = true;
        }
        actorEl.animate(actorKeyframes2, actorAnimConfig2);
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
          triggerClashSpark(40, "#63b3ed");
        } else {
          targetEl.animate([
            { transform: "translate(0,0) scale(1)", filter: "brightness(1)" },
            { transform: `translate(${dodgeDir * 0.5}px, 0) scale(0.94)`, filter: "brightness(1.8) contrast(1.3)", offset: 0.3 },
            { transform: "translate(0,0) scale(1)", filter: "brightness(1)", offset: 1 }
          ], { duration: 240 / speed, easing: "ease-out" });
          triggerClashSpark(40, shadowColor);
        }
        engineState.currentCombo.keepAlive = isNextFrameSameCombo;
        return frameDuration;
      }
      if (actorEl.getAnimations) actorEl.getAnimations().forEach((anim) => anim.cancel());
      if (targetEl.getAnimations) targetEl.getAnimations().forEach((anim) => anim.cancel());
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
        triggerClashSpark(60, "#f6e05e");
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
          triggerClashSpark(80, "#63b3ed");
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
          triggerClashSpark(40, "#63b3ed");
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
          triggerClashSpark(70, "#63b3ed");
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
      if (!frame.isCounter && frame.type !== "COUNTER") {
        engineState.currentCombo.keepAlive = isNextFrameSameCombo;
      }
      if (frame.skillId === "kibayuki_demand" && frame.type === "DAMAGE") {
        targetKeyframes = [
          { transform: "translate(0, 0) rotate(0deg)", filter: "brightness(1)" },
          { transform: "translate(-12px, -4px) rotate(-6deg)", filter: "brightness(1.6)", offset: 0.2 },
          { transform: "translate(10px, 2px) rotate(5deg)", offset: 0.4 },
          { transform: "translate(-10px, -2px) rotate(-5deg)", offset: 0.6 },
          { transform: "translate(8px, 0) rotate(3deg)", offset: 0.8 },
          { transform: "translate(0, 0) rotate(0deg)", filter: "brightness(1)", offset: 1 }
        ];
        targetAnimConfig.duration = 420 / speed;
      }
      if (frame.rosarioEvent === "PIERCE_CROSS") {
        triggerClashSpark(60, "#f687b3");
        triggerClashSpark(140, "#b794f4");
        const crossEl = targetEl.querySelector(".rosario-cross-mark");
        if (crossEl) {
          crossEl.classList.add("shatter");
          setTimeout(() => {
            if (crossEl.isConnected) crossEl.remove();
          }, 450 / speed);
        }
      }
      actorEl.animate(actorKeyframes, actorAnimConfig);
      if (targetKeyframes.length > 0) {
        targetEl.animate(targetKeyframes, targetAnimConfig);
      }
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
    engineState.currentCombo.heldForCoverActorId = null;
    engineState.currentCombo.knockedBack = true;
    engineState.currentCombo.keepAlive = false;
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
      } else if (frame.vfx.includes("flash-purple")) {
        floatEl.style.color = "#b794f4";
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
        .close-btn { align-self: flex-start; margin-top: 30px; background: ${theme.main}; color: ${theme.dark}; border: none; padding: 15px 40px; font-size: 20px; font-weight: 900; cursor: pointer; transform: skewX(-10deg); box-shadow: 4px 4px 0 rgba(0,0,0,0.5); opacity: 0; transition: transform 0.1s, box-shadow 0.1s; animation: slideInLeft 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
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
        mvpImg.src = "https://via.placeholder.com/600";
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
        <div style="width: 140px; text-align: right;">OUTPUT / TAKEN</div>
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
      const { actor, totalOutput, totalTaken } = stats;
      const dmgPct = maxTotalDamage > 0 ? totalOutput / maxTotalDamage * 100 : 0;
      const formatNum = (num) => Math.round(num).toLocaleString("en-US");
      const row = document.createElement("div");
      row.className = "stat-row";
      row.style.animationDelay = `${delayCounter}s`;
      row.innerHTML = `
            <div class="stat-name">${actor.name}</div>
            <div class="stat-bar-wrapper">
                <div class="stat-bar-fill" style="--target-width: ${dmgPct}%; animation-delay: ${delayCounter + 0.2}s;"></div>
            </div>
            <div class="stat-numbers">
                <div class="stat-dmg" id="dmg-${actor.id}">0</div>
                <div class="stat-taken">TAKEN: ${formatNum(totalTaken)}</div>
            </div>
        `;
      statsContainer.appendChild(row);
      setTimeout(() => {
        const dmgEl = row.querySelector(`#dmg-${actor.id}`);
        if (dmgEl) animateValue(dmgEl, totalOutput, delayCounter + 0.2);
      }, 0);
      delayCounter += 0.1;
    });
    const closeBtn = document.createElement("button");
    closeBtn.className = "close-btn";
    closeBtn.textContent = "NEXT // \u7D50\u675F\u6F14\u51FA";
    closeBtn.style.animationDelay = `${delayCounter + 0.2}s`;
    closeBtn.onclick = () => overlay.remove();
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
    document.querySelectorAll("div").forEach((div) => {
      if (div.childElementCount === 0 && div.textContent.trim() === DEATH_BANNER_TEXT) {
        div.setAttribute("data-mdbv-gone", "");
      }
    });
    document.querySelectorAll("p").forEach((p) => {
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
          sibling.setAttribute("data-mdbv-hide", "");
          sibling = sibling.nextElementSibling;
        }
        dlg.setAttribute("data-mdbv-dialog-pending", "");
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

  // src/stage.js
  function createLogLineElement(frame) {
    const msgEl = document.createElement("div");
    const isDialogue = frame.type === "BOSS_DIALOGUE" || frame.type === "DIALOGUE";
    msgEl.className = `log-line ${isDialogue ? "dialogue-log" : "system-log"}`;
    msgEl.dataset.frameIndex = String(frame.index);
    const formattedMsg = formatLogMessage(frame.message, engineState.actors);
    msgEl.innerHTML = `<span style="color:#718096; margin-right:8px;">[${frame.index + 1}]</span> ${formattedMsg}`;
    return msgEl;
  }
  function createBattleStage() {
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
    playBtn.onclick = () => {
      if (!engineState.isPlaying) {
        if (engineState.currentFrameIndex === 0 || engineState.currentFrameIndex >= engineState.frames.length) {
          engineState.currentFrameIndex = 0;
          armSpoilerGuard(0);
          syncStageToAbsoluteState(0, true);
        }
        engineState.isPlaying = true;
        playBtn.textContent = "\u66AB\u505C";
        const token2 = nextPlaybackToken();
        playbackLoop(token2);
      } else {
        engineState.isPlaying = false;
        nextPlaybackToken();
        playBtn.textContent = "\u64AD\u653E";
      }
    };
    const speedBtn = document.createElement("button");
    speedBtn.textContent = `\u901F\u5EA6: ${engineState.playbackSpeed}x`;
    speedBtn.onclick = () => {
      const speeds = [1, 2, 4, 8];
      const currentIdx = speeds.indexOf(engineState.playbackSpeed);
      const nextIndex = (currentIdx === -1 ? 0 : currentIdx + 1) % speeds.length;
      engineState.playbackSpeed = speeds[nextIndex];
      speedBtn.textContent = `\u901F\u5EA6: ${engineState.playbackSpeed}x`;
    };
    const seekContainer = document.createElement("div");
    seekContainer.className = "seek-container";
    const seekLabel = document.createElement("span");
    seekLabel.id = "seek-label";
    seekLabel.textContent = `0 / ${engineState.frames.length}`;
    const seekRange = document.createElement("input");
    seekRange.type = "range";
    seekRange.id = "seek-range";
    seekRange.min = 0;
    seekRange.max = Math.max(0, engineState.frames.length - 1);
    seekRange.value = 0;
    seekRange.oninput = (e) => {
      const targetFrame = Number(e.target.value);
      engineState.currentFrameIndex = targetFrame;
      seekLabel.textContent = `${targetFrame} / ${engineState.frames.length}`;
      engineState.currentCombo = createEmptyCombo();
      const token2 = nextPlaybackToken();
      syncStageToAbsoluteState(targetFrame, false);
      if (engineState.isPlaying) {
        playbackLoop(token2);
      } else if (playBtn.textContent === "\u91CD\u65B0\u64AD\u653E") {
        playBtn.textContent = "\u64AD\u653E";
      }
    };
    seekContainer.appendChild(seekRange);
    seekContainer.appendChild(seekLabel);
    const closeBtn = document.createElement("button");
    closeBtn.className = "danger";
    closeBtn.textContent = "\u95DC\u9589\u6F14\u51FA";
    closeBtn.onclick = () => {
      engineState.isPlaying = false;
      engineState.timeScale = 1;
      nextPlaybackToken();
      releaseSpoilerGuard();
      if (engineState.hostElement) {
        engineState.hostElement.remove();
        engineState.hostElement = null;
      }
      const originalContent2 = document.querySelector(".css-1svsvwq");
      if (originalContent2) originalContent2.style.display = "";
    };
    controls.appendChild(playBtn);
    controls.appendChild(speedBtn);
    controls.appendChild(seekContainer);
    controls.appendChild(closeBtn);
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
            <div class="actor-name">${actor.name}</div>
            <div class="avatar-wrapper">
                <img class="avatar" src="${actor.avatar}" onerror="this.src='https://via.placeholder.com/150'">
            </div>
            <div class="hp-container"${hpContainerStyle}>
                <div class="hp-fill" id="hp-fill-${actor.id}"></div>
                <div class="hp-text" id="hp-text-${actor.id}">${hpTextContent}</div>
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
    const fatalityOverlay = document.createElement("div");
    fatalityOverlay.id = "fatality-overlay";
    fatalityOverlay.className = "fatality-overlay";
    stage.appendChild(controls);
    stage.appendChild(ctbBox);
    stage.appendChild(arena);
    stage.appendChild(dialogBox);
    stage.appendChild(fatalityOverlay);
    engineState.shadowRoot.appendChild(stage);
    const originalContent = document.querySelector(".css-1svsvwq");
    if (originalContent) originalContent.style.display = "none";
    engineState.isPlaying = true;
    updateATBUI(0, true);
    const token = nextPlaybackToken();
    playbackLoop(token);
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
        icon.innerHTML = `<img src="${actor.avatar}" onerror="this.src='https://via.placeholder.com/150'">`;
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
  function syncActorBondVisuals(sr, bondStateMap = null) {
    engineState.actors.forEach((actor) => {
      const wrapperEl = sr.getElementById(`actor-${actor.id}`);
      if (!wrapperEl) return;
      const bondInfo = bondStateMap ? bondStateMap.get(actor.id) : null;
      const existingBadge = wrapperEl.querySelector(".bond-ring-badge");
      if (bondInfo) {
        const profile = CONTRACT_SKILL_PROFILES[bondInfo.skillId];
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
  function syncStageToAbsoluteState(frameIndex, isInitialReset = false) {
    const sr = engineState.shadowRoot;
    if (!sr) return;
    engineState.timeScale = 1;
    engineState.currentCombo = createEmptyCombo();
    engineState.floatTracker.clear();
    const mvpPanel = sr.getElementById("mdbv-mvp-panel");
    if (mvpPanel) mvpPanel.remove();
    const fatalityOverlay = sr.getElementById("fatality-overlay");
    if (fatalityOverlay) fatalityOverlay.classList.remove("active");
    sr.querySelectorAll(
      ".ultimate-overlay, .contract-cutin-overlay, .rosario-cross-mark, .bridal-cover-shield, .speech-bubble, .dice-badge, .floating-text, .combo-text, .luck-drop, .break-stamp, .fatality-slash, .fatality-text"
    ).forEach((el) => el.remove());
    engineState.actors.forEach((actor) => {
      actor.lastUltimateTurn = null;
      const el = sr.getElementById(`actor-${actor.id}`);
      if (el) {
        if (el.getAnimations) el.getAnimations().forEach((anim) => anim.cancel());
        el.style.filter = "";
        el.style.transform = "";
        el.classList.remove("blink-active", "spawning");
      }
    });
    const dialog = sr.getElementById("dialog-box");
    if (dialog) {
      dialog.innerHTML = "";
      if (!isInitialReset && frameIndex > 0) {
        const fragment = document.createDocumentFragment();
        const limit = Math.min(frameIndex, engineState.frames.length);
        for (let i = 0; i < limit; i++) {
          const f = engineState.frames[i];
          if (f.skillTier === "ultimate" && ["SKILL_TEXT", "TEXT", "DAMAGE"].includes(f.type) && !f.isNormalAttack) {
            const a = engineState.actors.get(f.actorId);
            if (a) a.lastUltimateTurn = f.turnNumber;
          }
          if (f.message) {
            fragment.appendChild(createLogLineElement(f));
          }
        }
        dialog.appendChild(fragment);
        dialog.scrollTop = dialog.scrollHeight;
      }
    }
    if (isInitialReset || engineState.frames.length === 0) {
      engineState.actors.forEach((actor) => {
        actor.currentHp = actor.maxHp;
        const fillEl = sr.getElementById(`hp-fill-${actor.id}`);
        const textEl = sr.getElementById(`hp-text-${actor.id}`);
        const wrapperEl = sr.getElementById(`actor-${actor.id}`);
        if (fillEl && textEl && !actor.hideHp) {
          fillEl.style.transition = "none";
          fillEl.style.width = "100%";
          setTimeout(() => {
            fillEl.style.transition = "";
          }, 50);
          textEl.textContent = `${actor.maxHp}/${actor.maxHp}`;
          fillEl.classList.remove("warning", "danger");
        }
        if (wrapperEl) {
          wrapperEl.classList.remove("dead", "danger-state", "spawning");
          if (actor.initiallySpawned === false) wrapperEl.classList.add("unspawned");
          else wrapperEl.classList.remove("unspawned");
        }
      });
      syncActorBondVisuals(sr, null);
      updateATBUI(0, true);
      return;
    }
    const stateFrameIndex = Math.max(0, Math.min(frameIndex, engineState.frames.length - 1));
    const frame = engineState.frames[stateFrameIndex];
    if (!frame) return;
    frame.actorsHpState.forEach((currentHp, actorId) => {
      const actor = engineState.actors.get(actorId);
      const fillEl = sr.getElementById(`hp-fill-${actorId}`);
      const textEl = sr.getElementById(`hp-text-${actorId}`);
      const wrapperEl = sr.getElementById(`actor-${actorId}`);
      const isSpawned = frame.actorsSummonState ? frame.actorsSummonState.get(actorId) !== false : actor?.initiallySpawned !== false;
      if (wrapperEl) {
        if (!isSpawned) wrapperEl.classList.add("unspawned");
        else wrapperEl.classList.remove("unspawned");
      }
      if (actor) {
        if (fillEl && textEl && !actor.hideHp) {
          const pct = currentHp / actor.maxHp * 100;
          fillEl.style.transition = "none";
          fillEl.style.width = `${Math.max(0, Math.min(100, pct))}%`;
          setTimeout(() => {
            fillEl.style.transition = "";
          }, 50);
          textEl.textContent = `${Math.round(currentHp)}/${actor.maxHp}`;
          fillEl.classList.remove("warning", "danger");
          if (wrapperEl) wrapperEl.classList.remove("danger-state");
          if (pct > 0 && pct <= 25) {
            fillEl.classList.add("danger");
            if (wrapperEl) wrapperEl.classList.add("danger-state");
          } else if (pct > 0 && pct <= 50) {
            fillEl.classList.add("warning");
          }
        }
        actor.currentHp = currentHp;
        const isDead = frame.actorsDeathState ? frame.actorsDeathState.get(actorId) : currentHp <= 0;
        if (isDead && wrapperEl) {
          wrapperEl.classList.add("dead");
          wrapperEl.classList.remove("danger-state");
        } else if (!isDead && wrapperEl) {
          wrapperEl.classList.remove("dead");
        }
      }
    });
    syncActorBondVisuals(sr, frame.actorsBondState);
    updateATBUI(frame.turnNumber, true, frame.actorsSummonState);
  }
  async function playbackLoop(token) {
    while (engineState.currentFrameIndex < engineState.frames.length && engineState.isPlaying && engineState.playbackToken === token) {
      const frame = engineState.frames[engineState.currentFrameIndex];
      await renderFrame(frame, token);
      if (engineState.playbackToken !== token || !engineState.isPlaying) {
        return;
      }
      engineState.currentFrameIndex++;
      const sr = engineState.shadowRoot;
      if (sr) {
        const seekRange = sr.getElementById("seek-range");
        const seekLabel = sr.getElementById("seek-label");
        if (seekRange) seekRange.value = Math.min(engineState.currentFrameIndex, engineState.frames.length - 1);
        if (seekLabel) seekLabel.textContent = `${engineState.currentFrameIndex} / ${engineState.frames.length}`;
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
        summonedEl.classList.remove("unspawned");
        summonedEl.classList.add("spawning");
        setTimeout(() => {
          if (summonedEl.isConnected) summonedEl.classList.remove("spawning");
        }, 600);
      }
    }
    const isSpokenSkillQuote = frame.type === "SKILL_TEXT" && /^[^：「\s]+：「.+」$/.test(frame.message.trim());
    if (frame.type === "BOSS_DIALOGUE" || frame.type === "DIALOGUE" || isSpokenSkillQuote) {
      const readTime = renderSpeechBubble(frame, sr, token);
      frameDuration += isSpokenSkillQuote ? Math.min(readTime, 900) : readTime;
    }
    if (frame.diceCheck || ["FATIGUE", "FATIGUE_SKIP", "SILENCED"].includes(frame.type) || frame.type === "SKILL_TEXT") {
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
    if (frame.skillTier === "ultimate" && ["SKILL_TEXT", "TEXT", "DAMAGE"].includes(frame.type) && !frame.isNormalAttack) {
      const actor = engineState.actors.get(frame.actorId);
      const isMultiHitSubFrame = /^第\s*\d+\s*[劍擊發道]/.test(frame.message) || frame.rosarioEvent === "INSCRIBE_CROSS";
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
          if (targetEl.isConnected) targetEl.classList.remove("blink-active");
        }, 300);
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
          }, 1e3);
        }
        if (frame.vfx.includes("break-stamp")) {
          const breakEl = document.createElement("div");
          breakEl.className = "break-stamp";
          breakEl.textContent = "BREAK!";
          targetEl.appendChild(breakEl);
          setTimeout(() => {
            if (breakEl.isConnected) breakEl.remove();
          }, 1200);
          frameDuration = 1e3;
        }
      }
    }
    spawnFloatingText(frame, sr, isNextFrameSameCombo, isNextTargetDifferent);
    let triggeredFatality = false;
    let deadActorId = null;
    if (frame.isDeathEvent) {
      triggeredFatality = true;
      deadActorId = frame.deadActorId;
    }
    frame.actorsHpState.forEach((currentHp, actorId) => {
      const actor = engineState.actors.get(actorId);
      const fillEl = sr.getElementById(`hp-fill-${actorId}`);
      const textEl = sr.getElementById(`hp-text-${actorId}`);
      const wrapperEl = sr.getElementById(`actor-${actorId}`);
      const isDead = frame.actorsDeathState ? frame.actorsDeathState.get(actorId) : currentHp <= 0;
      if (actor) {
        if (fillEl && textEl && !actor.hideHp) {
          const pct = currentHp / actor.maxHp * 100;
          fillEl.style.width = `${Math.max(0, Math.min(100, pct))}%`;
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
          if (!triggeredFatality || deadActorId !== actorId) {
            wrapperEl.classList.add("dead");
          }
          wrapperEl.classList.remove("danger-state");
        } else if (!isDead && wrapperEl) {
          wrapperEl.classList.remove("dead");
        }
      }
    });
    if (triggeredFatality && deadActorId) {
      await playFatalitySequence(sr, deadActorId);
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
  var API_BASE = "https://mydoujin-backend.onrender.com";
  var originalFetch = window.fetch.bind(window);
  var lastAutoLaunchedReportId = null;
  function findBattlePayload(obj, depth = 0) {
    if (!obj || typeof obj !== "object" || depth > 3) return null;
    if (Array.isArray(obj.logs) && obj.logs.some((l) => l && typeof l === "object")) {
      return obj;
    }
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (val && typeof val === "object" && !Array.isArray(val)) {
        const found = findBattlePayload(val, depth + 1);
        if (found) return found;
      }
    }
    return null;
  }
  function hasValidParticipants(battleData) {
    const p = battleData?.participants;
    if (!p) return false;
    return Array.isArray(p.players) && p.players.length > 0 && p.players[0]?.stats?.hp != null;
  }
  async function prepareAndInitVisualizer(rawBattleData) {
    const battleData = findBattlePayload(rawBattleData);
    if (!battleData) return;
    const reportId = battleData.reportId != null ? String(battleData.reportId) : null;
    if (reportId && reportId === lastAutoLaunchedReportId && engineState.hostElement) {
      return;
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
    buildStateSnapshots(reportData.logs);
    engineState.actors.forEach((actor) => {
      actor.currentHp = actor.maxHp;
    });
    createBattleStage();
  }
  function createToggleButton() {
    if (!document.body || document.getElementById("mdbv-toggle-btn")) return;
    const btn = document.createElement("button");
    btn.id = "mdbv-toggle-btn";
    btn.textContent = "\u555F\u52D5\u8996\u89BA\u5316\u6F14\u51FA";
    btn.style.cssText = "position: fixed; bottom: 20px; right: 20px; z-index: 9999; background: #2c7a7b; color: white; border: none; padding: 10px 15px; border-radius: 8px; cursor: pointer; font-weight: bold; box-shadow: 0 4px 6px rgba(0,0,0,0.3);";
    btn.onclick = async () => {
      const match = location.pathname.match(/\/reports\/(\d+)/);
      if (match) {
        const reportId = match[1];
        btn.textContent = "\u8F09\u5165\u4E2D...";
        try {
          const token = localStorage.getItem("token");
          const headers = token ? { "Authorization": `Bearer ${token}` } : {};
          const response = await originalFetch(`${API_BASE}/api/battle-reports/${reportId}?_t=${Date.now()}`, {
            headers,
            cache: "no-store"
          });
          if (response.ok) {
            const data = await response.json();
            if (data && data.logs) initVisualizer(data);
            else alert("\u7121\u6CD5\u89E3\u6790\u6230\u5831\u8CC7\u6599");
          } else {
            alert(`\u8B80\u53D6\u6230\u5831\u5931\u6557 (\u932F\u8AA4\u78BC: ${response.status})`);
          }
        } catch (e) {
          console.error("Visualizer error:", e);
          alert("\u9023\u7DDA\u932F\u8AA4\uFF1A\u5DF2\u88AB\u700F\u89BD\u5668\u6216\u4F3A\u670D\u5668\u963B\u64CB\uFF0C\u8ACB\u67E5\u770B F12 \u4E3B\u63A7\u53F0");
        } finally {
          btn.textContent = "\u555F\u52D5\u8996\u89BA\u5316\u6F14\u51FA";
        }
      } else if (engineState.lastReportData) {
        initVisualizer(engineState.lastReportData);
      } else {
        alert("\u8ACB\u5148\u9032\u884C\u4E00\u5834\u6230\u9B25\u6216\u5728\u6230\u5831\u9801\u9762\u4F7F\u7528\u6B64\u529F\u80FD");
      }
    };
    document.body.appendChild(btn);
  }
  function installFetchInterceptor() {
    window.fetch = async function(...args) {
      const input = args[0];
      const init = args[1];
      const url = typeof input === "string" ? input : input?.url || "";
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
