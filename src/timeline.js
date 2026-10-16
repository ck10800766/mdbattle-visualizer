// ==========================================
// FILE: src/timeline.js
// ==========================================
/**
 * @fileoverview Stage timeline synchronization, ATB/CTB action bar progress calculation,
 * persistent contract bond badge rendering, and instant state restoration on seek/reset.
 */

import { DEFAULT_AVATAR_URL } from './constants.js';
import {
    CONTRACT_SKILL_PROFILES,
    ULTIMATE_CUTIN_EXCLUDED_SKILLS
} from './profiles.js';
import {
    engineState,
    createEmptyCombo,
    getEffectiveSpeed
} from './state.js';
import { formatLogMessage, escapeHtml } from './utils.js';
import {
    lookaheadComboState,
    advanceComboState,
    renderComboBanner
} from './combo.js';
import { spawnFloatingText } from './floatingText.js';
import {
    renderSpeechBubble,
    spawnStatusOrDiceBadge
} from './cinematics.js';
import {
    spawnAOEFanWave,
    spawnAOEProjectile,
    triggerAOETargetImpact
} from './choreography.js';


/**
 * Evaluates whether a given frame should trigger a full-screen Ultimate Cut-In.
 * Excludes normal attacks and passive cleave follow-ups (`ULTIMATE_CUTIN_EXCLUDED_SKILLS`).
 *
 * @param {object} frame - Combat frame to evaluate.
 * @returns {boolean} True if this frame initiates a primary ultimate skill cast.
 */
export function isPrimaryUltimateTriggerFrame(frame) {
    if (
        frame.skillTier !== 'ultimate' ||
        !['SKILL_TEXT', 'TEXT', 'DAMAGE'].includes(frame.type) ||
        frame.isNormalAttack ||
        ULTIMATE_CUTIN_EXCLUDED_SKILLS.has(frame.skillId)
    ) {
        return false;
    }
    return true;
}

/**
 * Creates a formatted DOM element for a single combat log line in the bottom dialog box.
 *
 * @param {object} frame - Combat frame containing the message and index.
 * @returns {HTMLDivElement} Constructed log line element.
 */
export function createLogLineElement(frame) {
    const msgEl = document.createElement('div');
    const isDialogue = frame.type === 'BOSS_DIALOGUE' || frame.type === 'DIALOGUE';
    msgEl.className = `log-line ${isDialogue ? 'dialogue-log' : 'system-log'}`;
    msgEl.dataset.frameIndex = String(frame.index);
    const formattedMsg = formatLogMessage(frame.message, engineState.actors);
    msgEl.innerHTML = `<span style="color:#718096; margin-right:8px;">[${frame.index + 1}]</span> ${formattedMsg}`;
    return msgEl;
}

/**
 * Updates actor icon positions along the top ATB/CTB action timeline bar based on each actor's
 * pre-calculated `turnNumbers` schedule relative to `currentTurn`.
 *
 * @param {number} currentTurn - Active turn number.
 * @param {boolean} [skipTransition=false] - Whether to snap immediately without CSS transition.
 * @param {Map<string, boolean>|null} [summonStateMap=null] - Map of currently spawned actors.
 */
export function updateATBUI(currentTurn, skipTransition = false, summonStateMap = null) {
    const sr = engineState.shadowRoot;
    if (!sr) return;
    const track = sr.getElementById('ctb-track');
    if (!track) return;

    engineState.actors.forEach(actor => {
        if (actor.currentHp <= 0 && actor.turnNumbers.length === 0) return;

        const isSpawned = summonStateMap
            ? summonStateMap.get(actor.id) !== false
            : actor.initiallySpawned !== false;

        let progress = 0;
        const turns = actor.turnNumbers;

        if (turns.length === 0) {
            progress = 0;
        } else if (currentTurn <= turns[0]) {
            progress = turns[0] > 0 ? (currentTurn / turns[0]) * 100 : 100;
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
                    progress = ((currentTurn - prev) / (next - prev)) * 100;
                } else {
                    const avgGap = turns.length > 1 ? (turns[turns.length - 1] - turns[0]) / (turns.length - 1) : 4;
                    progress = ((currentTurn - prev) / avgGap) * 100;
                    progress = Math.min(95, progress);
                }
            }
        }

        progress = Math.max(0, Math.min(100, progress));

        let icon = sr.getElementById(`ctb-icon-${actor.id}`);
        if (!icon) {
            icon = document.createElement('div');
            icon.id = `ctb-icon-${actor.id}`;
            icon.className = `ctb-icon ${actor.side}`;
            icon.innerHTML = `<img src="${escapeHtml(actor.avatar)}" onerror="this.src='${DEFAULT_AVATAR_URL}'">`;
            track.appendChild(icon);
        }

        icon.style.zIndex = Math.round(progress);

        const prevProgress = Number(icon.dataset.progress || 0);
        if (skipTransition || progress < prevProgress - 20) {
            icon.style.transition = 'none';
            icon.style.left = `${progress}%`;
            void icon.offsetHeight;
        } else {
            icon.style.transition = `left ${400 / getEffectiveSpeed()}ms linear`;
            icon.style.left = `${progress}%`;
        }

        if (progress === 100) icon.classList.add('acting');
        else icon.classList.remove('acting');

        if (!isSpawned || (actor.currentHp <= 0 && progress !== 100)) {
            icon.style.opacity = '0';
        } else {
            icon.style.opacity = '1';
        }

        icon.dataset.progress = progress;
    });
}

/**
 * Synchronizes persistent contract/marriage aura and ring badge visuals across all actors.
 *
 * @param {ShadowRoot} sr - Stage ShadowRoot instance.
 * @param {Map<string, {partnerId: string|null, skillId: string}>|null} [bondStateMap=null] - Active bond state map.
 */
export function syncActorBondVisuals(sr, bondStateMap = null) {
    engineState.actors.forEach(actor => {
        const wrapperEl = sr.getElementById(`actor-${actor.id}`);
        if (!wrapperEl) return;

        const bondInfo = bondStateMap ? bondStateMap.get(actor.id) : null;
        const existingBadge = wrapperEl.querySelector('.bond-ring-badge');

        if (bondInfo) {
            const profile = CONTRACT_SKILL_PROFILES[bondInfo.skillId];
            wrapperEl.classList.add('bond-active');
            if (!existingBadge) {
                const badge = document.createElement('div');
                badge.className = 'bond-ring-badge';
                const partner = bondInfo.partnerId ? engineState.actors.get(bondInfo.partnerId) : null;
                badge.textContent = partner
                    ? `${profile?.badgeIcon || '💍'} ${partner.name}`
                    : `${profile?.badgeIcon || '💍'} ${profile?.badgeText || '契約'}`;
                wrapperEl.appendChild(badge);
            }
        } else {
            wrapperEl.classList.remove('bond-active');
            if (existingBadge) existingBadge.remove();
        }
    });
}

/**
 * Updates HP bar widths, numeric HP labels, low-HP warning/danger states, and `.dead` classes
 * across all actors for a given frame snapshot.
 *
 * @param {ShadowRoot} sr - Stage ShadowRoot instance.
 * @param {object} frame - Frame snapshot containing `actorsHpState`, `actorsDeathState`, and `actorsSummonState`.
 * @param {object} [options={}] - Optional rendering behavior flags.
 * @param {boolean} [options.skipHpTransition=false] - Whether to disable CSS width transitions on HP bars (used during seek).
 * @param {boolean} [options.syncSummonVisibility=false] - Whether to snap `.unspawned` classes immediately (used during seek).
 * @param {string|null} [options.deferDeadClassForActorId=null] - Actor ID whose `.dead` class should wait until after K.O. fatality playback.
 */
export function syncActorHpAndDeathDOM(
    sr,
    frame,
    {
        skipHpTransition = false,
        syncSummonVisibility = false,
        deferDeadClassForActorId = null
    } = {}
) {
    frame.actorsHpState.forEach((currentHp, actorId) => {
        const actor = engineState.actors.get(actorId);
        const fillEl = sr.getElementById(`hp-fill-${actorId}`);
        const textEl = sr.getElementById(`hp-text-${actorId}`);
        const wrapperEl = sr.getElementById(`actor-${actorId}`);

        if (syncSummonVisibility && wrapperEl) {
            const isSpawned = frame.actorsSummonState
                ? frame.actorsSummonState.get(actorId) !== false
                : actor?.initiallySpawned !== false;
            wrapperEl.classList.remove('spawning', 'despawning');
            if (!isSpawned) wrapperEl.classList.add('unspawned');
            else wrapperEl.classList.remove('unspawned');
        }

        if (!actor) return;

        const isDead = frame.actorsDeathState ? frame.actorsDeathState.get(actorId) : (currentHp <= 0);

        if (fillEl && textEl && !actor.hideHp) {
            const pct = (currentHp / actor.maxHp) * 100;
            if (skipHpTransition) {
                fillEl.style.transition = 'none';
                fillEl.style.width = `${Math.max(0, Math.min(100, pct))}%`;
                setTimeout(() => { fillEl.style.transition = ''; }, 50);
            } else {
                fillEl.style.width = `${Math.max(0, Math.min(100, pct))}%`;
            }

            textEl.textContent = `${Math.round(currentHp)}/${actor.maxHp}`;
            fillEl.classList.remove('warning', 'danger');

            if (currentHp > 0 && pct <= 25) {
                fillEl.classList.add('danger');
                if (wrapperEl && !isDead) wrapperEl.classList.add('danger-state');
            } else if (currentHp > 0 && pct <= 50) {
                fillEl.classList.add('warning');
                if (wrapperEl) wrapperEl.classList.remove('danger-state');
            } else {
                if (wrapperEl) wrapperEl.classList.remove('danger-state');
            }
        }

        actor.currentHp = currentHp;

        if (isDead && wrapperEl) {
            const shouldDefer =
                deferDeadClassForActorId instanceof Set
                    ? deferDeadClassForActorId.has(actorId)
                    : deferDeadClassForActorId === actorId;
            if (!shouldDefer) {
                wrapperEl.classList.add('dead');
            }
            wrapperEl.classList.remove('danger-state');
        } else if (!isDead && wrapperEl) {
            wrapperEl.classList.remove('dead');
        }
    });
}

/**
 * Renders the active combat situation preview for a specific frame when timeline scrubbing or stepping:
 * - Reconstructs current-turn combo counts and cumulative damage up to `frameIndex`
 * - Displays a top Situation HUD Banner showing Turn, Action Type, Preceding Skill Quote, and Current Log
 * - Positions acting and targeted units in their combat engagement poses (lunge, center-stage AOE, or cover)
 * - Triggers floating damage/heal numbers, speech bubbles, overhead badges, and AOE wave VFX
 *
 * @param {ShadowRoot} sr - Stage ShadowRoot instance.
 * @param {number} frameIndex - Target frame index being previewed.
 */
function renderSeekPreviewState(sr, frameIndex) {
    const arena = sr.getElementById('arena');
    const frame = engineState.frames[frameIndex];
    if (!arena || !frame) return;

    const speed = getEffectiveSpeed();

    // 1. Reconstruct combo state within the current turn up to frameIndex
    engineState.currentCombo = createEmptyCombo();
    let turnStartIdx = frameIndex;
    while (
        turnStartIdx > 0 &&
        engineState.frames[turnStartIdx - 1]?.turnNumber === frame.turnNumber
    ) {
        turnStartIdx--;
    }
    for (let i = turnStartIdx; i <= frameIndex; i++) {
        const f = engineState.frames[i];
        if (f.actorId && ['DAMAGE', 'MISS', 'COUNTER', 'BLOCK'].includes(f.type) && !f.isCounterSetup) {
            const lookahead = lookaheadComboState(i, f);
            advanceComboState(f, lookahead.isNextFrameSameCombo);
        }
    }

    if (
        engineState.currentCombo.count > 1 &&
        ['DAMAGE', 'MISS', 'BLOCK'].includes(frame.type) &&
        !frame.isCounter
    ) {
        renderComboBanner(arena, frame, speed);
    }

    // 2. Locate preceding SKILL_TEXT context within the same turn for the active caster
    const activeCasterId = frame.aoeCasterId || frame.actorId;
    let skillContextFrame = null;
    if (frame.type !== 'SKILL_TEXT') {
        for (let i = frameIndex - 1; i >= Math.max(0, turnStartIdx - 1); i--) {
            const prev = engineState.frames[i];
            if (prev.turnNumber !== frame.turnNumber) break;
            if (prev.type === 'SKILL_TEXT' && (!activeCasterId || prev.actorId === activeCasterId)) {
                skillContextFrame = prev;
                break;
            }
        }
    }

    // 3. Render top Situation HUD Banner
    let actionLabel = '📜 戰況紀錄';
    if (frame.isAOE) actionLabel = '💥 範圍攻擊 (AOE)';
    else if (frame.isCoverEvent) actionLabel = '🛡️ 護衛代償 (COVER)';
    else if (frame.type === 'COUNTER' || frame.isCounter) actionLabel = '⚡ 反擊交鋒 (COUNTER)';
    else if (frame.skillTier === 'ultimate') actionLabel = '✨ 奧義發動 (ULTIMATE)';
    else if (frame.type === 'HEAL' || frame.isBeneficial) actionLabel = '💚 恢復 / 增益';
    else if (frame.type === 'SUMMON' || frame.isSummonEvent) actionLabel = '🌀 召喚登場';
    else if (frame.type === 'SKILL_TEXT') actionLabel = '🔮 技能施展';
    else if (['DAMAGE', 'BLOCK', 'MISS'].includes(frame.type)) actionLabel = '⚔️ 戰鬥交鋒';

    const actorObj = activeCasterId ? engineState.actors.get(activeCasterId) : null;
    const targetObj = frame.targetId ? engineState.actors.get(frame.targetId) : null;
    let engagementHtml = '';
    if (actorObj && frame.isAOE) {
        engagementHtml = `<span>${escapeHtml(actorObj.name)} ➔ 全體範圍目標</span>`;
    } else if (actorObj && targetObj && actorObj.id !== targetObj.id) {
        engagementHtml = `<span>${escapeHtml(actorObj.name)} ➔ ${escapeHtml(targetObj.name)}</span>`;
    } else if (actorObj) {
        engagementHtml = `<span>${escapeHtml(actorObj.name)}</span>`;
    }

    const bannerEl = document.createElement('div');
    bannerEl.className = 'seek-situation-banner';
    const contextHtml = skillContextFrame?.message
        ? `<div class="seek-skill-context">▸ ${formatLogMessage(skillContextFrame.message, engineState.actors)}</div>`
        : '';
    const bodyHtml = frame.message
        ? `<div class="seek-banner-body">${formatLogMessage(frame.message, engineState.actors)}</div>`
        : '';
    bannerEl.innerHTML = `
        <div class="seek-banner-header">
            <span class="seek-turn-pill">TURN ${frame.turnNumber}</span>
            <span class="seek-skill-pill">${actionLabel}</span>
            ${engagementHtml}
        </div>
        ${contextHtml}
        ${bodyHtml}
    `;
    arena.appendChild(bannerEl);

    // 4. Position actors in active combat engagement poses instead of standing idle at origin
    const arenaRect = arena.getBoundingClientRect();
    const actorEl = activeCasterId ? sr.getElementById(`actor-${activeCasterId}`) : null;
    const targetEl = frame.targetId ? sr.getElementById(`actor-${frame.targetId}`) : null;

    if (actorEl) actorEl.classList.add('seek-acting');
    if (targetEl && targetEl !== actorEl) targetEl.classList.add('seek-targeted');

    if (frame.isAOE && actorEl && arenaRect.width > 0) {
        const aRect = actorEl.getBoundingClientRect();
        const cMoveX = (arenaRect.left + arenaRect.width / 2) - (aRect.left + aRect.width / 2);
        const cDeltaY = (arenaRect.top + arenaRect.height / 2) - (aRect.top + aRect.height / 2);
        const side = actorObj?.side || 'left';
        const targetSide = targetObj?.side || (side === 'left' ? 'right' : 'left');
        const shadowColor = side === 'left' ? '#63b3ed' : '#fc8181';

        actorEl.style.zIndex = '10';
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
            const gSide = actorObj?.side || 'left';
            const guardOffsetX = (pRect.left - gRect.left) + (gSide === 'left' ? 55 : -55);
            const guardOffsetY = pRect.top - gRect.top;
            actorEl.style.zIndex = '15';
            actorEl.style.transform = `translate(${guardOffsetX}px, ${guardOffsetY}px) scale(1.12)`;
            actorEl.style.filter = 'drop-shadow(0 0 16px #f687b3)';
        }
    } else if (
        actorEl &&
        targetEl &&
        actorEl !== targetEl &&
        ['DAMAGE', 'MISS', 'COUNTER', 'BLOCK'].includes(frame.type) &&
        !frame.isSelfDamage &&
        !frame.isEnvironmentalPulse
    ) {
        const aRect = actorEl.getBoundingClientRect();
        const tRect = targetEl.getBoundingClientRect();
        const side = actorObj?.side || 'left';
        const targetSide = targetObj?.side || (side === 'left' ? 'right' : 'left');
        const shadowColor = side === 'left' ? '#63b3ed' : '#fc8181';
        const moveX = (tRect.left - aRect.left) + (side === 'left' ? -60 : 60);
        const deltaY = tRect.top - aRect.top;

        actorEl.style.zIndex = '10';
        actorEl.style.transform = `translate(${moveX}px, ${deltaY}px) scale(1.1)`;
        actorEl.style.filter = `drop-shadow(0 0 12px ${shadowColor})`;

        triggerAOETargetImpact(frame, arena, targetEl, targetSide, shadowColor, speed);
    }

    // 5. Render speech bubbles, overhead status/dice badges, and floating combat numbers for this frame
    const isSpokenSkillQuote =
        frame.type === 'SKILL_TEXT' &&
        /^[^：「\s]+：「.+」$/.test(frame.message.trim());
    if (frame.type === 'BOSS_DIALOGUE' || frame.type === 'DIALOGUE' || isSpokenSkillQuote) {
        renderSpeechBubble(frame, sr, engineState.playbackToken);
    }

    if (
        frame.diceCheck ||
        ['FATIGUE', 'FATIGUE_SKIP', 'SILENCED', 'SKILL_TEXT', 'TEXT'].includes(frame.type)
    ) {
        spawnStatusOrDiceBadge(frame, sr);
    }

    spawnFloatingText(frame, sr, false, false);
}

/**
 * Instantly synchronizes the entire stage DOM (HP bars, death states, summon visibility,
 * log history, contract bonds, and ATB icons) to any target frame index during timeline seeking or reset.
 *
 * @param {number} frameIndex - Target frame index to synchronize to.
 * @param {boolean} [isInitialReset=false] - True when resetting back to pre-battle state (frame 0).
 * @param {boolean} [showActivePreview=false] - When true, renders the active skill HUD, combat poses, and floating numbers for `frameIndex`.
 */
export function syncStageToAbsoluteState(frameIndex, isInitialReset = false, showActivePreview = false) {
    const sr = engineState.shadowRoot;
    if (!sr) return;

    engineState.timeScale = 1.0;
    engineState.currentCombo = createEmptyCombo();
    engineState.floatTracker.clear();

    const mvpPanel = sr.getElementById('mdbv-mvp-panel');
    if (mvpPanel) mvpPanel.remove();

    const fatalityOverlay = sr.getElementById('fatality-overlay');
    if (fatalityOverlay) fatalityOverlay.classList.remove('active');

    // Remove all transient overlays, badges, and floating combat effects
    sr.querySelectorAll(
        '.ultimate-overlay, .contract-cutin-overlay, .rosario-cross-mark, .bridal-cover-shield, .speech-bubble, .dice-badge, .floating-text, .combo-text, .luck-drop, .break-stamp, .fatality-slash, .fatality-text, .seek-situation-banner, .aoe-fan-wave, .aoe-projectile'
    ).forEach(el => el.remove());

    // Cancel active Web Animations and reset actor transforms
    engineState.actors.forEach(actor => {
        actor.lastUltimateTurn = null;
        const el = sr.getElementById(`actor-${actor.id}`);
        if (el) {
            if (el.getAnimations) el.getAnimations().forEach(anim => anim.cancel());
            el.style.filter = '';
            el.style.transform = '';
            el.style.zIndex = '';
            el.classList.remove('blink-active', 'spawning', 'despawning', 'seek-acting', 'seek-targeted');
        }
    });

    const stateFrameIndex = Math.max(0, Math.min(frameIndex, engineState.frames.length - 1));

    // Rebuild combat log history up to frameIndex (inclusive when previewing a paused/stepped frame)
    const dialog = sr.getElementById('dialog-box');
    if (dialog) {
        dialog.innerHTML = '';
        if (!isInitialReset && engineState.frames.length > 0) {
            const fragment = document.createDocumentFragment();
            const limit = showActivePreview
                ? Math.min(stateFrameIndex + 1, engineState.frames.length)
                : Math.min(frameIndex, engineState.frames.length);
            for (let i = 0; i < limit; i++) {
                const f = engineState.frames[i];
                if (isPrimaryUltimateTriggerFrame(f)) {
                    const a = engineState.actors.get(f.actorId);
                    if (a) a.lastUltimateTurn = f.turnNumber;
                }
                if (f.message) {
                    const lineEl = createLogLineElement(f);
                    if (showActivePreview && i === stateFrameIndex) {
                        lineEl.classList.add('current-frame-log');
                    }
                    fragment.appendChild(lineEl);
                }
            }
            dialog.appendChild(fragment);
            dialog.scrollTop = dialog.scrollHeight;
        }
    }

    if (isInitialReset || engineState.frames.length === 0) {
        engineState.actors.forEach(actor => {
            actor.currentHp = actor.maxHp;
            const fillEl = sr.getElementById(`hp-fill-${actor.id}`);
            const textEl = sr.getElementById(`hp-text-${actor.id}`);
            const wrapperEl = sr.getElementById(`actor-${actor.id}`);
            if (fillEl && textEl && !actor.hideHp) {
                fillEl.style.transition = 'none';
                fillEl.style.width = '100%';
                setTimeout(() => { fillEl.style.transition = ''; }, 50);
                textEl.textContent = `${actor.maxHp}/${actor.maxHp}`;
                fillEl.classList.remove('warning', 'danger');
            }
            if (wrapperEl) {
                wrapperEl.classList.remove('dead', 'danger-state', 'spawning', 'despawning', 'seek-acting', 'seek-targeted');
                if (actor.initiallySpawned === false) wrapperEl.classList.add('unspawned');
                else wrapperEl.classList.remove('unspawned');
            }
        });
        syncActorBondVisuals(sr, null);
        updateATBUI(0, true);
        return;
    }

    const frame = engineState.frames[stateFrameIndex];
    if (!frame) return;

    syncActorHpAndDeathDOM(sr, frame, {
        skipHpTransition: true,
        syncSummonVisibility: true
    });
    syncActorBondVisuals(sr, frame.actorsBondState);
    updateATBUI(frame.turnNumber, true, frame.actorsSummonState);

    if (showActivePreview) {
        renderSeekPreviewState(sr, stateFrameIndex);
    }
}


