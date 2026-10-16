// ==========================================
// FILE: src/stage.js
// ==========================================
/**
 * @fileoverview Shadow DOM battle stage mounting, playback controls (Play/Pause, Speed, Seek, Close),
 * and the main asynchronous frame execution pipeline (`playbackLoop` and `renderFrame`).
 */

import {
    DEFAULT_AVATAR_URL,
    HOST_CONTENT_SELECTOR,
    PLAYBACK_SPEEDS
} from './constants.js';
import {
    getLuckDropEmoji,
    ULTIMATE_SUBFRAME_REGEX
} from './profiles.js';
import {
    engineState,
    createEmptyCombo,
    getEffectiveSpeed,
    nextPlaybackToken
} from './state.js';
import { escapeHtml } from './utils.js';
import { STAGE_STYLES } from './styles.js';
import {
    playFatalitySequence,
    playUltimateCutIn,
    playContractCutIn,
    spawnRosarioCross,
    renderSpeechBubble,
    spawnStatusOrDiceBadge
} from './cinematics.js';
import {
    lookaheadComboState,
    playCombatAnimation,
    playCoverAnimation
} from './choreography.js';
import { spawnFloatingText } from './floatingText.js';
import { showMVPPanel } from './mvp.js';
import { armSpoilerGuard, releaseSpoilerGuard } from './spoilerGuard.js';
import {
    isPrimaryUltimateTriggerFrame,
    createLogLineElement,
    updateATBUI,
    syncActorBondVisuals,
    syncActorHpAndDeathDOM,
    syncStageToAbsoluteState
} from './timeline.js';

export { updateATBUI, syncStageToAbsoluteState };

/**
 * Mounts the Shadow DOM battle stage, playback controls, ATB timeline, actor cards, and log box.
 * Automatically starts playback from frame 0 upon mounting.
 */
export function createBattleStage() {
    if (engineState.hostElement) engineState.hostElement.remove();

    const host = document.createElement('div');
    host.id = 'mdbv-host';
    host.style.cssText = 'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 2147483647; background: #000;';
    document.body.appendChild(host);

    engineState.hostElement = host;
    engineState.shadowRoot = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = STAGE_STYLES;
    engineState.shadowRoot.appendChild(style);

    const stage = document.createElement('div');
    stage.className = 'stage';

    const controls = document.createElement('div');
    controls.className = 'controls';

    const playBtn = document.createElement('button');
    playBtn.id = 'btn-play';
    playBtn.textContent = '暫停';
    playBtn.onclick = () => {
        if (!engineState.isPlaying) {
            if (engineState.currentFrameIndex === 0 || engineState.currentFrameIndex >= engineState.frames.length) {
                engineState.currentFrameIndex = 0;
                armSpoilerGuard(0);
                syncStageToAbsoluteState(0, true);
            }
            engineState.isPlaying = true;
            playBtn.textContent = '暫停';
            const token = nextPlaybackToken();
            playbackLoop(token);
        } else {
            engineState.isPlaying = false;
            nextPlaybackToken();
            playBtn.textContent = '播放';
        }
    };

    const speedBtn = document.createElement('button');
    speedBtn.textContent = `速度: ${engineState.playbackSpeed}x`;
    speedBtn.onclick = () => {
        const currentIdx = PLAYBACK_SPEEDS.indexOf(engineState.playbackSpeed);
        const nextIndex = (currentIdx === -1 ? 0 : currentIdx + 1) % PLAYBACK_SPEEDS.length;
        engineState.playbackSpeed = PLAYBACK_SPEEDS[nextIndex];
        speedBtn.textContent = `速度: ${engineState.playbackSpeed}x`;
    };

    const seekContainer = document.createElement('div');
    seekContainer.className = 'seek-container';
    const seekLabel = document.createElement('span');
    seekLabel.id = 'seek-label';
    seekLabel.textContent = `0 / ${engineState.frames.length}`;
    const seekRange = document.createElement('input');
    seekRange.type = 'range';
    seekRange.id = 'seek-range';
    seekRange.min = 0;
    seekRange.max = Math.max(0, engineState.frames.length - 1);
    seekRange.value = 0;

    seekRange.oninput = (e) => {
        const targetFrame = Number(e.target.value);
        engineState.currentFrameIndex = targetFrame;
        seekLabel.textContent = `${targetFrame} / ${engineState.frames.length}`;
        engineState.currentCombo = createEmptyCombo();

        const token = nextPlaybackToken();
        syncStageToAbsoluteState(targetFrame, false);

        if (engineState.isPlaying) {
            playbackLoop(token);
        } else if (playBtn.textContent === '重新播放') {
            playBtn.textContent = '播放';
        }
    };

    seekContainer.appendChild(seekRange);
    seekContainer.appendChild(seekLabel);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'danger';
    closeBtn.textContent = '關閉演出';
    closeBtn.onclick = () => {
        engineState.isPlaying = false;
        engineState.timeScale = 1.0;
        nextPlaybackToken();
        releaseSpoilerGuard();
        if (engineState.hostElement) {
            engineState.hostElement.remove();
            engineState.hostElement = null;
        }
        document.querySelectorAll(`[data-mdbv-hidden-host], ${HOST_CONTENT_SELECTOR}`).forEach(el => {
            el.style.display = '';
            el.removeAttribute('data-mdbv-hidden-host');
        });
    };

    controls.appendChild(playBtn);
    controls.appendChild(speedBtn);
    controls.appendChild(seekContainer);
    controls.appendChild(closeBtn);

    const ctbBox = document.createElement('div');
    ctbBox.className = 'ctb-container';
    ctbBox.innerHTML = `
        <div class="ctb-track" id="ctb-track">
            <div class="ctb-action-point">ACTION</div>
        </div>
    `;

    const arena = document.createElement('div');
    arena.className = 'arena';
    arena.id = 'arena';

    const leftTeam = document.createElement('div');
    leftTeam.className = 'team left-team';

    const rightTeam = document.createElement('div');
    rightTeam.className = 'team right-team';

    engineState.actors.forEach(actor => {
        const el = document.createElement('div');
        const unspawnedClass = actor.initiallySpawned === false ? 'unspawned' : '';
        el.className = `actor ${actor.side} ${unspawnedClass}`.trim();
        el.id = `actor-${actor.id}`;
        const hpContainerStyle = actor.hideHp ? ' style="display: none;"' : '';
        const hpTextContent = actor.hideHp ? '' : `${actor.maxHp}/${actor.maxHp}`;
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
        if (actor.side === 'left') leftTeam.appendChild(el);
        else rightTeam.appendChild(el);
    });

    arena.appendChild(leftTeam);
    arena.appendChild(rightTeam);

    const dialogBox = document.createElement('div');
    dialogBox.className = 'dialog-box';
    dialogBox.id = 'dialog-box';

    const fatalityOverlay = document.createElement('div');
    fatalityOverlay.id = 'fatality-overlay';
    fatalityOverlay.className = 'fatality-overlay';

    stage.appendChild(controls);
    stage.appendChild(ctbBox);
    stage.appendChild(arena);
    stage.appendChild(dialogBox);
    stage.appendChild(fatalityOverlay);
    engineState.shadowRoot.appendChild(stage);

    const originalContent = document.querySelector(HOST_CONTENT_SELECTOR);
    if (originalContent) {
        originalContent.setAttribute('data-mdbv-hidden-host', 'true');
        originalContent.style.display = 'none';
    }

    engineState.isPlaying = true;
    updateATBUI(0, true);
    const token = nextPlaybackToken();
    playbackLoop(token);
}

/**
 * Main asynchronous playback loop that steps through frames until paused, cancelled, or finished.
 * Once the final frame finishes, releases the spoiler guard and displays the post-battle MVP overlay.
 *
 * @param {number} token - Playback token bound to this loop invocation.
 * @returns {Promise<void>}
 */
export async function playbackLoop(token) {
    while (
        engineState.currentFrameIndex < engineState.frames.length &&
        engineState.isPlaying &&
        engineState.playbackToken === token
    ) {
        const frame = engineState.frames[engineState.currentFrameIndex];
        await renderFrame(frame, token);

        if (engineState.playbackToken !== token || !engineState.isPlaying) {
            return;
        }

        engineState.currentFrameIndex++;

        const sr = engineState.shadowRoot;
        if (sr) {
            const seekRange = sr.getElementById('seek-range');
            const seekLabel = sr.getElementById('seek-label');
            if (seekRange) seekRange.value = Math.min(engineState.currentFrameIndex, engineState.frames.length - 1);
            if (seekLabel) seekLabel.textContent = `${engineState.currentFrameIndex} / ${engineState.frames.length}`;
        }
    }

    if (engineState.playbackToken === token && engineState.currentFrameIndex >= engineState.frames.length) {
        engineState.isPlaying = false;
        releaseSpoilerGuard();
        const sr = engineState.shadowRoot;
        if (sr) {
            const playBtn = sr.getElementById('btn-play');
            if (playBtn) playBtn.textContent = '重新播放';
        }
        showMVPPanel();
        engineState.currentFrameIndex = 0;
    }
}

/**
 * Renders a single combat frame including log appending, summon spawns/despawns, dialogues,
 * ultimate cut-ins, physical combat choreography, floating numbers, HP bar updates, and K.O. sequences.
 *
 * @param {object} frame - Frame snapshot to render.
 * @param {number} token - Active playback token for cancellation checks across async steps.
 * @returns {Promise<void>}
 */
export async function renderFrame(frame, token) {
    const sr = engineState.shadowRoot;
    if (!sr || engineState.playbackToken !== token) return;

    const arena = sr.getElementById('arena');
    const dialog = sr.getElementById('dialog-box');
    let frameDuration = 600;

    // 1. Append combat log line
    if (frame.message && dialog) {
        if (dialog.lastElementChild?.dataset?.frameIndex !== String(frame.index)) {
            const msgEl = createLogLineElement(frame);
            dialog.appendChild(msgEl);
            dialog.scrollTop = dialog.scrollHeight;
        }
    }

    // 2. Animate dynamic summon spawn or voluntary despawn
    if (frame.isSummonEvent && frame.summonedActorId) {
        const summonedEl = sr.getElementById(`actor-${frame.summonedActorId}`);
        if (summonedEl) {
            summonedEl.classList.remove('unspawned', 'despawning');
            summonedEl.classList.add('spawning');
            setTimeout(() => {
                if (engineState.playbackToken === token && summonedEl.isConnected) {
                    summonedEl.classList.remove('spawning');
                }
            }, 600 / getEffectiveSpeed());
        }
    }

    if (frame.isDespawnEvent && frame.despawnedActorId) {
        const despawnedEl = sr.getElementById(`actor-${frame.despawnedActorId}`);
        if (despawnedEl) {
            despawnedEl.classList.remove('spawning');
            despawnedEl.classList.add('despawning');
            setTimeout(() => {
                if (engineState.playbackToken === token && despawnedEl.isConnected) {
                    despawnedEl.classList.remove('despawning');
                    despawnedEl.classList.add('unspawned');
                }
            }, 450 / getEffectiveSpeed());
        }
    }

    // 3. Render speech bubble for boss dialogue or spoken skill quotes
    const isSpokenSkillQuote =
        frame.type === 'SKILL_TEXT' &&
        /^[^：「\s]+：「.+」$/.test(frame.message.trim());

    if (frame.type === 'BOSS_DIALOGUE' || frame.type === 'DIALOGUE' || isSpokenSkillQuote) {
        const readTime = renderSpeechBubble(frame, sr, token);
        frameDuration += isSpokenSkillQuote ? Math.min(readTime, 900) : readTime;
    }

    // 4. Spawn overhead dice check or character flavor badges
    if (
        frame.diceCheck ||
        ['FATIGUE', 'FATIGUE_SKIP', 'SILENCED'].includes(frame.type) ||
        frame.type === 'SKILL_TEXT' ||
        frame.type === 'TEXT'
    ) {
        spawnStatusOrDiceBadge(frame, sr);
    }

    // 5. Update ATB bar and persistent marriage/contract bond indicators
    updateATBUI(frame.turnNumber, false, frame.actorsSummonState);
    syncActorBondVisuals(sr, frame.actorsBondState);

    // 6. Play full-screen Contract Cut-In, Rosario Cross inscription, or Ultimate Cut-In
    if (frame.contractEvent === 'ACCEPT') {
        await playContractCutIn(frame, sr, token);
        if (engineState.playbackToken !== token) return;
        frameDuration = 450;
    }

    if (frame.rosarioEvent === 'INSCRIBE_CROSS') {
        spawnRosarioCross(frame, sr);
        frameDuration = 520;
    }

    if (isPrimaryUltimateTriggerFrame(frame)) {
        const actor = engineState.actors.get(frame.actorId);
        const isMultiHitSubFrame =
            ULTIMATE_SUBFRAME_REGEX.test(frame.message.trim()) ||
            frame.rosarioEvent === 'INSCRIBE_CROSS';

        if (actor && actor.lastUltimateTurn !== frame.turnNumber && !isMultiHitSubFrame) {
            actor.lastUltimateTurn = frame.turnNumber;
            await playUltimateCutIn(frame, sr, token);
            if (engineState.playbackToken !== token) return;
        } else if (actor && isMultiHitSubFrame) {
            actor.lastUltimateTurn = frame.turnNumber;
        }
    }

    // 7. Execute physical combat or cover guard choreography
    const {
        isNextFrameSameCombo,
        isNextTargetDifferent,
        shouldReturnToOrigin
    } = lookaheadComboState(engineState.currentFrameIndex, frame);

    if (frame.isCoverEvent) {
        frameDuration = playCoverAnimation(frame, sr);
    } else if (frame.actorId && ['DAMAGE', 'MISS', 'COUNTER', 'BLOCK'].includes(frame.type)) {
        frameDuration = playCombatAnimation(
            frame,
            sr,
            isNextFrameSameCombo,
            isNextTargetDifferent,
            shouldReturnToOrigin
        );
    }

    // 8. Trigger arena shake, dodge blink, luck drop, and BREAK! stamp VFX
    if (frame.vfx.includes('screen-shake') && arena) {
        arena.classList.remove('shake-active');
        void arena.offsetWidth;
        arena.classList.add('shake-active');
        frameDuration = Math.max(frameDuration, 600);
    }

    if (frame.vfx.includes('dodge-blink') && frame.targetId) {
        const targetEl = sr.getElementById(`actor-${frame.targetId}`);
        if (targetEl) {
            targetEl.classList.add('blink-active');
            setTimeout(() => {
                if (engineState.playbackToken === token && targetEl.isConnected) {
                    targetEl.classList.remove('blink-active');
                }
            }, 300 / getEffectiveSpeed());
        }
    }

    if (frame.targetId) {
        const targetEl = sr.getElementById(`actor-${frame.targetId}`);
        if (targetEl) {
            if (frame.vfx.includes('luck-drop')) {
                const dropEl = document.createElement('div');
                dropEl.className = 'luck-drop';
                dropEl.textContent = getLuckDropEmoji(frame.message);
                targetEl.appendChild(dropEl);
                setTimeout(() => {
                    if (dropEl.isConnected) dropEl.remove();
                }, 1000 / getEffectiveSpeed());
            }
            if (frame.vfx.includes('break-stamp')) {
                const breakEl = document.createElement('div');
                breakEl.className = 'break-stamp';
                breakEl.textContent = 'BREAK!';
                targetEl.appendChild(breakEl);
                setTimeout(() => {
                    if (breakEl.isConnected) breakEl.remove();
                }, 1200 / getEffectiveSpeed());
                frameDuration = 1000;
            }
        }
    }

    // 9. Spawn floating damage/heal numbers and cumulative combo counters
    spawnFloatingText(frame, sr, isNextFrameSameCombo, isNextTargetDifferent);

    // 10. Synchronize HP bars and play K.O. fatality sequence on newly defeated units
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
            deadWrapper.classList.add('dead');
        }
    }

    const actualDelay = frameDuration / getEffectiveSpeed();
    await new Promise(resolve => setTimeout(resolve, actualDelay));
}