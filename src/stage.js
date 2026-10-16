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
    setPlaybackSpeed,
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
    advanceComboState,
    renderComboBanner
} from './combo.js';
import {
    playCombatAnimation,
    playCoverAnimation,
    playAOEWaveBatchChoreography,
    triggerAOETargetImpact
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
 * Formats the timeline seek counter label with both current Turn and Frame index.
 * @param {number} frameIndex - Current frame index.
 * @returns {string} Formatted label string.
 */
function formatSeekLabelText(frameIndex) {
    const total = engineState.frames.length;
    if (total === 0) return 'T0 ｜ 0 / 0';
    const clamped = Math.max(0, Math.min(frameIndex, total - 1));
    const turn = engineState.frames[clamped]?.turnNumber ?? 0;
    return `T${turn} ｜ ${ Math.min(frameIndex, total) } / ${total}`;
}

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

    const navGroup = document.createElement('div');
    navGroup.className = 'control-group';

    const playBtn = document.createElement('button');
    playBtn.id = 'btn-play';
    playBtn.textContent = '暫停';

    const seekContainer = document.createElement('div');
    seekContainer.className = 'seek-container';
    const seekLabel = document.createElement('span');
    seekLabel.id = 'seek-label';
    seekLabel.textContent = formatSeekLabelText(0);
    const seekRange = document.createElement('input');
    seekRange.type = 'range';
    seekRange.id = 'seek-range';
    seekRange.min = 0;
    seekRange.max = Math.max(0, engineState.frames.length - 1);
    seekRange.value = 0;

    /**
     * Jumps to a specific frame index in paused inspection mode and renders its active combat situation.
     * @param {number} targetIdx - Target frame index.
     */
    const jumpToFrame = (targetIdx) => {
        if (engineState.frames.length === 0) return;
        const clamped = Math.max(0, Math.min(targetIdx, engineState.frames.length - 1));
        engineState.isPlaying = false;
        nextPlaybackToken();
        engineState.currentFrameIndex = clamped;
        playBtn.textContent = '播放';
        seekRange.value = clamped;
        seekLabel.textContent = formatSeekLabelText(clamped);
        syncStageToAbsoluteState(clamped, false, true);
    };

    const prevTurnBtn = document.createElement('button');
    prevTurnBtn.className = 'btn-nav';
    prevTurnBtn.title = '跳至上一回合';
    prevTurnBtn.textContent = '⏮ 回合';
    prevTurnBtn.onclick = () => {
        if (engineState.frames.length === 0) return;
        const curIdx = Math.max(0, Math.min(engineState.currentFrameIndex, engineState.frames.length - 1));
        const curTurn = engineState.frames[curIdx]?.turnNumber ?? 1;
        let firstOfCurrentTurn = curIdx;
        while (firstOfCurrentTurn > 0 && engineState.frames[firstOfCurrentTurn - 1]?.turnNumber === curTurn) {
            firstOfCurrentTurn--;
        }
        // If we are mid-turn, jump to the start of the current turn; otherwise jump to the start of the previous turn
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

    const prevFrameBtn = document.createElement('button');
    prevFrameBtn.className = 'btn-nav';
    prevFrameBtn.title = '單步後退一幀';
    prevFrameBtn.textContent = '⏪ 單步';
    prevFrameBtn.onclick = () => {
        jumpToFrame(engineState.currentFrameIndex - 1);
    };

    playBtn.onclick = () => {
        if (!engineState.isPlaying) {
            if (engineState.currentFrameIndex === 0 || engineState.currentFrameIndex >= engineState.frames.length) {
                engineState.currentFrameIndex = 0;
                armSpoilerGuard(0);
                syncStageToAbsoluteState(0, true, false);
            } else {
                // Clear static seek preview before resuming live playback from currentFrameIndex
                syncStageToAbsoluteState(engineState.currentFrameIndex, false, false);
            }
            engineState.isPlaying = true;
            playBtn.textContent = '暫停';
            const token = nextPlaybackToken();
            playbackLoop(token);
        } else {
            engineState.isPlaying = false;
            nextPlaybackToken();
            playBtn.textContent = '播放';
            syncStageToAbsoluteState(engineState.currentFrameIndex, false, true);
        }
    };

    const nextFrameBtn = document.createElement('button');
    nextFrameBtn.className = 'btn-nav';
    nextFrameBtn.title = '單步前進一幀';
    nextFrameBtn.textContent = '單步 ⏩';
    nextFrameBtn.onclick = () => {
        jumpToFrame(engineState.currentFrameIndex + 1);
    };

    const nextTurnBtn = document.createElement('button');
    nextTurnBtn.className = 'btn-nav';
    nextTurnBtn.title = '跳至下一回合';
    nextTurnBtn.textContent = '回合 ⏭';
    nextTurnBtn.onclick = () => {
        if (engineState.frames.length === 0) return;
        const curIdx = Math.max(0, Math.min(engineState.currentFrameIndex, engineState.frames.length - 1));
        const curTurn = engineState.frames[curIdx]?.turnNumber ?? 0;
        let nextIdx = curIdx + 1;
        while (nextIdx < engineState.frames.length && engineState.frames[nextIdx]?.turnNumber <= curTurn) {
            nextIdx++;
        }
        jumpToFrame(Math.min(nextIdx, engineState.frames.length - 1));
    };

    navGroup.appendChild(prevTurnBtn);
    navGroup.appendChild(prevFrameBtn);
    navGroup.appendChild(playBtn);
    navGroup.appendChild(nextFrameBtn);
    navGroup.appendChild(nextTurnBtn);

    const speedBtn = document.createElement('button');
    speedBtn.id = 'btn-speed';
    speedBtn.title = '切換播放倍速 (自動記憶於瀏覽器)';
    speedBtn.textContent = `速度: ${engineState.playbackSpeed}x`;
    speedBtn.onclick = () => {
        const currentIdx = PLAYBACK_SPEEDS.indexOf(engineState.playbackSpeed);
        const nextIndex = (currentIdx === -1 ? 0 : currentIdx + 1) % PLAYBACK_SPEEDS.length;
        const nextSpeed = setPlaybackSpeed(PLAYBACK_SPEEDS[nextIndex]);
        speedBtn.textContent = `速度: ${nextSpeed}x`;
    };

    seekRange.oninput = (e) => {
        const targetFrame = Number(e.target.value);
        engineState.currentFrameIndex = targetFrame;
        seekLabel.textContent = formatSeekLabelText(targetFrame);
        engineState.currentCombo = createEmptyCombo();

        const token = nextPlaybackToken();

        if (engineState.isPlaying) {
            syncStageToAbsoluteState(targetFrame, false, false);
            playbackLoop(token);
        } else {
            if (playBtn.textContent === '重新播放') {
                playBtn.textContent = '播放';
            }
            syncStageToAbsoluteState(targetFrame, false, true);
        }
    };

    seekContainer.appendChild(seekRange);
    seekContainer.appendChild(seekLabel);

    const skipBtn = document.createElement('button');
    skipBtn.id = 'btn-skip';
    skipBtn.className = 'btn-skip';
    skipBtn.title = '跳過戰鬥過程，直接前往最終狀態與 MVP 結算面板';
    skipBtn.textContent = '⏭ 跳至結算';
    skipBtn.onclick = () => {
        engineState.isPlaying = false;
        engineState.timeScale = 1.0;
        nextPlaybackToken();
        const finalIdx = Math.max(0, engineState.frames.length - 1);
        engineState.currentFrameIndex = engineState.frames.length;
        seekRange.value = finalIdx;
        seekLabel.textContent = formatSeekLabelText(engineState.frames.length);
        syncStageToAbsoluteState(finalIdx, false, false);
        releaseSpoilerGuard();
        playBtn.textContent = '重新播放';
        showMVPPanel();
    };

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

    controls.appendChild(navGroup);
    controls.appendChild(speedBtn);
    controls.appendChild(seekContainer);
    controls.appendChild(skipBtn);
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
 * Collects consecutive non-counter AOE wave frames starting at `startIndex` that share the same caster,
 * allowing `playbackLoop` to execute them as a single fluid multi-target AOE wave barrage instead of
 * slow sequential single-target hits.
 *
 * @param {number} startIndex - Starting frame index.
 * @returns {Array<object>} Batch of consecutive AOE frames (length >= 1, or empty if not an AOE hit).
 */
function collectAOEWaveBatch(startIndex) {
    const first = engineState.frames[startIndex];
    if (
        !first ||
        !first.isAOE ||
        first.isCounter ||
        first.type === 'COUNTER' ||
        !['DAMAGE', 'MISS', 'BLOCK'].includes(first.type)
    ) {
        return [];
    }

    const casterId = first.aoeCasterId || first.actorId;
    const batch = [first];
    let idx = startIndex + 1;

    while (idx < engineState.frames.length) {
        const cur = engineState.frames[idx];
        if (
            cur &&
            cur.isAOE &&
            !cur.isCounter &&
            cur.type !== 'COUNTER' &&
            ['DAMAGE', 'MISS', 'BLOCK'].includes(cur.type) &&
            (cur.aoeCasterId || cur.actorId) === casterId
        ) {
            batch.push(cur);
            if (cur.isAOELast) break;
            idx++;
        } else {
            break;
        }
    }

    return batch;
}

/**
 * Renders a multi-target AOE wave batch as a unified sweeping shockwave and projectile barrage
 * with rapid staggered target impacts (65ms ripple), floating numbers, and HP bar updates.
 *
 * @param {Array<object>} waveFrames - Batch of consecutive AOE combat frames.
 * @param {number} token - Active playback token.
 * @returns {Promise<void>}
 */
async function renderAOEWaveBatch(waveFrames, token) {
    const sr = engineState.shadowRoot;
    if (!sr || engineState.playbackToken !== token || waveFrames.length === 0) return;

    const arena = sr.getElementById('arena');
    const dialog = sr.getElementById('dialog-box');
    const firstFrame = waveFrames[0];

    // 1. Check and play Ultimate Cut-In on the first frame of the AOE wave if applicable
    if (isPrimaryUltimateTriggerFrame(firstFrame)) {
        const actor = engineState.actors.get(firstFrame.actorId);
        const isMultiHitSubFrame =
            ULTIMATE_SUBFRAME_REGEX.test(firstFrame.message.trim()) ||
            firstFrame.rosarioEvent === 'INSCRIBE_CROSS';

        if (actor && actor.lastUltimateTurn !== firstFrame.turnNumber && !isMultiHitSubFrame) {
            actor.lastUltimateTurn = firstFrame.turnNumber;
            await playUltimateCutIn(firstFrame, sr, token);
            if (engineState.playbackToken !== token) return;
        } else if (actor && isMultiHitSubFrame) {
            actor.lastUltimateTurn = firstFrame.turnNumber;
        }
    }

    // 2. Update ATB timeline and bond state
    updateATBUI(firstFrame.turnNumber, false, firstFrame.actorsSummonState);
    syncActorBondVisuals(sr, firstFrame.actorsBondState);

    // 3. Launch center-stage AOE caster animation, crescent shockwave, and projectile barrage
    const { staggerMs, impactDelayMs, totalDurationMs, shadowColor } = playAOEWaveBatchChoreography(waveFrames, sr);

    const hasCritShake = waveFrames.some(wf => wf.vfx.includes('screen-shake'));
    if (hasCritShake && arena) {
        setTimeout(() => {
            if (engineState.playbackToken === token && arena.isConnected) {
                arena.classList.remove('shake-active');
                void arena.offsetWidth;
                arena.classList.add('shake-active');
            }
        }, impactDelayMs / getEffectiveSpeed());
    }

    const waveDeadActorIds = new Set(
        waveFrames.filter(wf => wf.isDeathEvent && wf.deadActorId).map(wf => wf.deadActorId)
    );

    // 4. Schedule rapid staggered impacts (65ms ripple) across all wave targets
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
            const targetSide = engineState.actors.get(wf.targetId)?.side || 'right';
            if (targetEl && arena) {
                triggerAOETargetImpact(wf, arena, targetEl, targetSide, shadowColor, speed);
                if (wf.vfx.includes('dodge-blink')) {
                    targetEl.classList.add('blink-active');
                    setTimeout(() => {
                        if (engineState.playbackToken === token && targetEl.isConnected) {
                            targetEl.classList.remove('blink-active');
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

    await new Promise(resolve => setTimeout(resolve, totalDurationMs / getEffectiveSpeed()));
    if (engineState.playbackToken !== token) return;

    // 5. Play K.O. fatality sequence for any target(s) defeated during this AOE wave
    for (const wf of waveFrames) {
        if (wf.isDeathEvent && wf.deadActorId) {
            await playFatalitySequence(sr, wf.deadActorId, token);
            if (engineState.playbackToken !== token) return;
            const deadWrapper = sr.getElementById(`actor-${wf.deadActorId}`);
            if (deadWrapper) {
                deadWrapper.classList.add('dead');
            }
        }
    }
}

/**
 * Main asynchronous playback loop that steps through frames until paused, cancelled, or finished.
 * Automatically batches multi-target AOE wave frames into a fluid sweeping barrage.
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
            const seekRange = sr.getElementById('seek-range');
            const seekLabel = sr.getElementById('seek-label');
            if (seekRange) seekRange.value = Math.min(engineState.currentFrameIndex, engineState.frames.length - 1);
            if (seekLabel) seekLabel.textContent = formatSeekLabelText(engineState.currentFrameIndex);
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