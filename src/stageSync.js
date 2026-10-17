// ==========================================
// FILE: src/stageSync.js
// ==========================================
/**
 * @fileoverview Stage DOM state synchronization, seek situation previews,
 * actor HP/death DOM restoration, log reconstruction, and transient VFX cleanup.
 * Decoupled from pure timeline mathematical progression.
 */

import { DEFAULT_AVATAR_URL } from './constants.js';
import { getContractSkillProfile } from './profiles.js';
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
    spawnStatusOrDiceBadge,
    resolveDialogueSpeaker,
    isSceneNarrationFrame,
    renderSceneNarrationBanner
} from './cinematics.js';
import {
    spawnAOEFanWave,
    spawnAOEProjectile,
    triggerAOETargetImpact
} from './choreography.js';
import { updateATBUI } from './timeline.js';

/**
 * Creates a formatted DOM element for a single combat log line in the bottom dialog box.
 *
 * @param {object} frame - Combat frame containing the message and index.
 * @returns {HTMLDivElement} Constructed log line element.
 */
export function createLogLineElement(frame) {
    const msgEl = document.createElement('div');
    const speaker = resolveDialogueSpeaker(frame);
    const isDialogue = Boolean(speaker) || (frame.type === 'DIALOGUE' && /[「『"“]/.test(frame.message));
    const isNarrative = !isDialogue && isSceneNarrationFrame(frame);

    let logClass = 'system-log';
    if (isDialogue) {
        logClass = 'dialogue-log';
    } else if (isNarrative) {
        logClass = 'narrative-log';
    }

    msgEl.className = `log-line ${logClass}`;
    msgEl.dataset.frameIndex = String(frame.index);
    msgEl.title = `點擊跳轉至此影格 (#${frame.index + 1})`;
    const formattedMsg = formatLogMessage(frame.message, engineState.actors);
    msgEl.innerHTML = `<span class="log-index" style="color:#718096; margin-right:8px;">[${frame.index + 1}]</span> ${formattedMsg}`;
    return msgEl;
}

/**
 * Synchronizes persistent contract/marriage aura across all actors.
 *
 * @param {ShadowRoot} sr - Stage ShadowRoot instance.
 * @param {Map<string, {partnerId: string|null, skillId: string}>|null} [bondStateMap=null] - Active bond state map.
 */
export function syncActorBondVisuals(sr, bondStateMap = null) {
    engineState.actors.forEach(actor => {
        const wrapperEl = sr.getElementById(`actor-${actor.id}`);
        if (!wrapperEl) return;

        const bondInfo = bondStateMap ? bondStateMap.get(actor.id) : null;
        const isDead = wrapperEl.classList.contains('dead');

        if (bondInfo && !isDead) {
            wrapperEl.classList.add('bond-active');
        } else {
            wrapperEl.classList.remove('bond-active');
        }

        const existingBadge = wrapperEl.querySelector('.bond-ring-badge');
        if (existingBadge) existingBadge.remove();
    });
}

/**
 * Synchronizes persistent status tray badges (marriage/bond, DOT, HOT, FATIGUE, SILENCED)
 * and shield border highlights across all actors.
 *
 * @param {ShadowRoot} sr - Stage ShadowRoot instance.
 * @param {Map<string, Array<{ id: string, name: string, category: string, icon: string }>>|null} [statusStateMap=null] - Active status state map.
 * @param {Map<string, boolean>|null} [shieldStateMap=null] - Active shield state map.
 * @param {Map<string, {partnerId: string|null, skillId: string}>|null} [bondStateMap=null] - Active bond state map.
 */
export function syncActorStatusAndShieldDOM(sr, statusStateMap = null, shieldStateMap = null, bondStateMap = null) {
    engineState.actors.forEach(actor => {
        const hpContainer = sr.getElementById(`hp-container-${actor.id}`) || sr.querySelector(`#actor-${actor.id} .hp-container`);
        const statusTray = sr.getElementById(`status-tray-${actor.id}`);
        const wrapperEl = sr.getElementById(`actor-${actor.id}`);
        const isDead = wrapperEl?.classList.contains('dead');

        // 1. Sync shield active blue border
        const isShieldActive = !isDead && (shieldStateMap ? !!shieldStateMap.get(actor.id) : false);
        if (hpContainer) {
            if (isShieldActive) hpContainer.classList.add('shield-active');
            else hpContainer.classList.remove('shield-active');
        }

        // 2. Sync status badges (including marriage/contract bond)
        if (statusTray) {
            const statuses = (!isDead && statusStateMap) ? [...(statusStateMap.get(actor.id) || [])] : [];
            const bondInfo = (!isDead && bondStateMap) ? bondStateMap.get(actor.id) : null;
            if (bondInfo) {
                const profile = getContractSkillProfile(bondInfo.skillId);
                const partner = bondInfo.partnerId ? engineState.actors.get(bondInfo.partnerId) : null;
                statuses.unshift({
                    id: 'bond',
                    name: partner ? `${profile?.badgeIcon || '💍'} ${partner.name}` : `${profile?.badgeIcon || '💍'} ${profile?.badgeText || '契約'}`,
                    category: 'bond',
                    icon: profile?.badgeIcon || '💍'
                });
            }

            if (statuses.length === 0) {
                statusTray.innerHTML = '';
            } else {
                const badgesHtml = statuses.map(st =>
                    `<span class="status-badge status-${escapeHtml(st.category)}" title="${escapeHtml(st.name)}">${escapeHtml(st.icon)}</span>`
                ).join('');
                if (statusTray.innerHTML !== badgesHtml) {
                    statusTray.innerHTML = badgesHtml;
                }
            }
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
 * @param {string|Set<string>|null} [options.deferDeadClassForActorId=null] - Actor ID whose `.dead` class should wait.
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
            const hpContainer = sr.getElementById(`hp-container-${actorId}`);
            if (hpContainer) hpContainer.style.display = '';
            const statusTray = sr.getElementById(`status-tray-${actorId}`);
            if (statusTray) statusTray.style.display = '';

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
            const hpContainer = sr.getElementById(`hp-container-${actorId}`);
            if (hpContainer) hpContainer.classList.remove('shield-active');
            const statusTray = sr.getElementById(`status-tray-${actorId}`);
            if (statusTray) statusTray.innerHTML = '';

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
 * Renders the active combat situation preview for a specific frame when timeline scrubbing or stepping.
 *
 * @param {ShadowRoot} sr - Stage ShadowRoot instance.
 * @param {number} frameIndex - Target frame index being previewed.
 */
export function renderSeekPreviewState(sr, frameIndex) {
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
        engagementHtml = `<span>發起全體攻擊</span>`;
    } else if (actorObj && targetObj && actorObj !== targetObj) {
        engagementHtml = `<span>對 <strong>${escapeHtml(targetObj.name)}</strong></span>`;
    }

    const bannerEl = document.createElement('div');
    bannerEl.className = 'seek-situation-banner';
    const skillPill = frame.skillName
        ? `<span class="seek-skill-pill">${escapeHtml(frame.skillName)}</span>`
        : '';
    const skillContextHtml = skillContextFrame
        ? `<span class="seek-skill-context">【${escapeHtml(skillContextFrame.skillName || skillContextFrame.message)}】</span>`
        : '';

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

    // 4. Highlight active combatants and set combat engagement poses
    const actorEl = activeCasterId ? sr.getElementById(`actor-${activeCasterId}`) : null;
    const targetEl = frame.targetId ? sr.getElementById(`actor-${frame.targetId}`) : null;
    if (actorEl) actorEl.classList.add('seek-acting');
    if (targetEl && targetEl !== actorEl) targetEl.classList.add('seek-targeted');

    const arenaRect = arena.getBoundingClientRect();
    if (frame.isAOE && actorEl) {
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

    // 5. Render speech bubbles, scene narration subtitle banner, and overhead badges
    const speaker = resolveDialogueSpeaker(frame);
    if (speaker) {
        renderSpeechBubble(frame, sr, engineState.playbackToken);
    } else if (isSceneNarrationFrame(frame)) {
        renderSceneNarrationBanner(frame, sr, engineState.playbackToken);
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
 * @param {number} frameIndex - Target frame index to synchronize stage DOM to.
 * @param {boolean} [isInitialReset=false] - Whether this sync is a full playback restart from frame 0.
 * @param {boolean} [showActivePreview=false] - Whether to render interactive combat pose and situation banner.
 */
export function syncStageToAbsoluteState(frameIndex, isInitialReset = false, showActivePreview = false) {
    const sr = engineState.shadowRoot;
    if (!sr) return;

    engineState.currentCombo = createEmptyCombo();
    engineState.floatTracker.clear();

    const mvpPanel = sr.getElementById('mdbv-mvp-panel');
    if (mvpPanel) mvpPanel.remove();

    const fatalityOverlay = sr.getElementById('fatality-overlay');
    if (fatalityOverlay) fatalityOverlay.classList.remove('active');

    // Remove all transient overlays, badges, and floating combat effects
    sr.querySelectorAll(
        '.ultimate-overlay, .contract-cutin-overlay, .rosario-cross-mark, .bridal-cover-shield, .speech-bubble, .dice-badge, .floating-text, .combo-text, .luck-drop, .break-stamp, .fatality-slash, .fatality-text, .seek-situation-banner, .aoe-fan-wave, .aoe-projectile, .arena-field-wave, .scene-narration-banner'
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

    // Rebuild combat log history up to frameIndex
    const dialog = sr.getElementById('dialog-box');
    if (dialog) {
        dialog.innerHTML = '';
        if (!isInitialReset && engineState.frames.length > 0) {
            const fragment = document.createDocumentFragment();
            const limit = showActivePreview
                ? Math.min(stateFrameIndex, engineState.frames.length - 1)
                : Math.min(stateFrameIndex - 1, engineState.frames.length - 1);
            const startLogIdx = Math.max(0, limit - 30);
            for (let i = startLogIdx; i <= limit; i++) {
                const f = engineState.frames[i];
                if (f && f.message) {
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

    if (engineState.frames.length === 0) return;

    if (isInitialReset) {
        // Reset to initial pre-combat state
        engineState.actors.forEach(actor => {
            actor.currentHp = actor.maxHp;
            const fillEl = sr.getElementById(`hp-fill-${actor.id}`);
            const textEl = sr.getElementById(`hp-text-${actor.id}`);
            const wrapperEl = sr.getElementById(`actor-${actor.id}`);

            if (wrapperEl) {
                wrapperEl.classList.remove('dead', 'danger-state');
                if (actor.initiallySpawned === false) wrapperEl.classList.add('unspawned');
                else wrapperEl.classList.remove('unspawned');
            }
            if (fillEl && textEl && !actor.hideHp) {
                fillEl.style.transition = 'none';
                fillEl.style.width = '100%';
                fillEl.classList.remove('warning', 'danger');
                textEl.textContent = `${actor.maxHp}/${actor.maxHp}`;
            }
        });

        updateATBUI(1, true);
        syncActorBondVisuals(sr, null);
        syncActorStatusAndShieldDOM(sr, null, null);
    } else {
        const frame = engineState.frames[stateFrameIndex];
        if (!frame) return;

        // Restore HP bars, dead states, and summon visibility
        syncActorHpAndDeathDOM(sr, frame, {
            skipHpTransition: true,
            syncSummonVisibility: true,
            deferDeadClassForActorId: null
        });

        // Restore ATB progress, contract bond visual auras, and status/shield DOM
        updateATBUI(frame.turnNumber, true, frame.actorsSummonState);
        syncActorBondVisuals(sr, frame.actorsBondState);
        syncActorStatusAndShieldDOM(sr, frame.actorsStatusState, frame.actorsShieldState, frame.actorsBondState);

        // When paused or stepping, render active combat situation preview
        if (showActivePreview) {
            renderSeekPreviewState(sr, stateFrameIndex);
        }
    }
}
