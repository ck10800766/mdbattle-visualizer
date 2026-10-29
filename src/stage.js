// ==========================================
// FILE: src/stage.js
// ==========================================
/**
 * @fileoverview Shadow DOM battle stage mounting, playback controls (Play/Pause, Speed, Seek, Close),
 * and the main asynchronous frame execution pipeline (`playbackLoop` and `renderFrame`).
 */

import {
    APP_VERSION,
    DEFAULT_AVATAR_URL,
    HOST_CONTENT_SELECTOR,
    PLAYBACK_SPEEDS
} from './constants.js';
import {
    getLuckDropEmoji,
    ULTIMATE_SUBFRAME_REGEX,
    normalizeAOESkillGroup
} from './profiles.js';
import {
    engineState,
    createEmptyCombo,
    getEffectiveSpeed,
    setPlaybackSpeed,
    nextPlaybackToken
} from './state.js';
import { escapeHtml, getMessageReadingDuration } from './utils.js';
import { STAGE_STYLES } from './styles.js';
import {
    playFatalitySequence,
    playUltimateCutIn,
    playContractCutIn,
    spawnRosarioCross,
    renderSpeechBubble,
    spawnStatusOrDiceBadge,
    playEnvironmentalFieldPulse,
    resolveDialogueSpeaker,
    isSceneNarrationFrame,
    renderSceneNarrationBanner,
    shouldDeferUltimateCutIn,
    isUltimateCutInQuoteFrame
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
    triggerAOETargetImpact,
    spawnRadiantPartyWave
} from './choreography.js';
import { spawnFloatingText } from './floatingText.js';
import { showMVPPanel } from './mvp.js';
import { armSpoilerGuard, releaseSpoilerGuard } from './spoilerGuard.js';
import {
    isPrimaryUltimateTriggerFrame,
    extractTimelineMarkers,
    formatSeekLabelText,
    updateATBUI
} from './timeline.js';
import {
    createLogLineElement,
    syncActorBondVisuals,
    syncActorStatusAndShieldDOM,
    syncActorHpAndDeathDOM,
    syncStageToAbsoluteState,
    updateDynamicTeamLayout
} from './stageSync.js';
import {
    exportCurrentBattleReport,
    promptImportBattleReport,
    parseImportedReportText
} from './reportIO.js';

export { updateATBUI, syncStageToAbsoluteState };

/**
 * Cleanly unmounts the battle stage, stops active playback and keyboard listeners,
 * releases the spoiler guard, and restores the original host page content.
 */
export function closeBattleStage() {
    if (engineState.stageResizeObserver) {
        engineState.stageResizeObserver.disconnect();
        engineState.stageResizeObserver = null;
    }
    if (engineState.stageResizeHandler) {
        window.removeEventListener('resize', engineState.stageResizeHandler);
        engineState.stageResizeHandler = null;
    }
    if (engineState.activeKeydownHandler) {
        window.removeEventListener('keydown', engineState.activeKeydownHandler);
        engineState.activeKeydownHandler = null;
    }
    if (engineState.activePointerUpHandler) {
        window.removeEventListener('pointerup', engineState.activePointerUpHandler);
        engineState.activePointerUpHandler = null;
    }
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
}

/**
 * Mounts the Shadow DOM battle stage, playback controls, ATB timeline, actor cards, and log box.
 * Automatically starts playback from frame 0 upon mounting.
 */
export function createBattleStage() {
    if (engineState.activeKeydownHandler) {
        window.removeEventListener('keydown', engineState.activeKeydownHandler);
        engineState.activeKeydownHandler = null;
    }
    if (engineState.activePointerUpHandler) {
        window.removeEventListener('pointerup', engineState.activePointerUpHandler);
        engineState.activePointerUpHandler = null;
    }
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

    const seekContainer = document.createElement('div');
    seekContainer.className = 'seek-container';
    const seekLabel = document.createElement('span');
    seekLabel.id = 'seek-label';
    seekLabel.textContent = formatSeekLabelText(0);

    const seekTrackWrapper = document.createElement('div');
    seekTrackWrapper.className = 'seek-track-wrapper';

    const seekRange = document.createElement('input');
    seekRange.type = 'range';
    seekRange.id = 'seek-range';
    seekRange.min = 0;
    seekRange.max = Math.max(0, engineState.frames.length - 1);
    seekRange.value = 0;

    const seekMarkersLayer = document.createElement('div');
    seekMarkersLayer.className = 'seek-markers-layer';

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
    timelineMarkers.forEach(marker => {
        const pin = document.createElement('div');
        pin.className = `seek-pin pin-${marker.category}`;
        const pct = Math.max(0, Math.min(100, (marker.frameIndex / maxFrameIdx) * 100));
        pin.style.left = `${pct}%`;
        pin.dataset.frameIndex = marker.frameIndex;
        pin.dataset.pct = pct;

        const tooltip = document.createElement('div');
        tooltip.className = 'seek-pin-tooltip';
        if (pct < 15) tooltip.classList.add('tooltip-align-left');
        else if (pct > 85) tooltip.classList.add('tooltip-align-right');
        const titleEl = document.createElement('span');
        titleEl.className = 'seek-pin-tooltip-title';
        titleEl.textContent = `T${marker.turnNumber} (#${marker.frameIndex + 1}) ｜ ${marker.title}`;
        tooltip.appendChild(titleEl);
        if (marker.detail) {
            const detailEl = document.createElement('span');
            detailEl.className = 'seek-pin-tooltip-detail';
            detailEl.textContent = marker.detail;
            tooltip.appendChild(detailEl);
        }
        pin.appendChild(tooltip);

        seekMarkersLayer.appendChild(pin);
    });

    const seekHoverTooltip = document.createElement('div');
    seekHoverTooltip.className = 'seek-hover-tooltip';

    seekTrackWrapper.appendChild(seekRange);
    seekTrackWrapper.appendChild(seekMarkersLayer);
    seekTrackWrapper.appendChild(seekHoverTooltip);

    let activeHoverPin = null;
    let isDraggingSeek = false;

    seekRange.addEventListener('pointerdown', () => {
        isDraggingSeek = true;
        if (activeHoverPin) {
            activeHoverPin.classList.remove('pin-hover');
            activeHoverPin = null;
        }
        seekHoverTooltip.classList.remove('active');
    });

    const onPointerUpGlobal = () => {
        isDraggingSeek = false;
    };
    engineState.activePointerUpHandler = onPointerUpGlobal;
    window.addEventListener('pointerup', onPointerUpGlobal);

    seekTrackWrapper.onpointermove = (e) => {
        if (isDraggingSeek || engineState.frames.length === 0) return;

        const rect = seekMarkersLayer.getBoundingClientRect();
        if (rect.width <= 0) return;

        const mouseX = e.clientX - rect.left;
        const clampedMouseX = Math.max(0, Math.min(mouseX, rect.width));
        const pct = clampedMouseX / rect.width;
        const hoverFrameIdx = Math.round(pct * (engineState.frames.length - 1));
        const frame = engineState.frames[hoverFrameIdx];

        // Proximity detection: find closest milestone pin
        let closestPin = null;
        let minPixelDist = Infinity;

        const pinElements = seekMarkersLayer.querySelectorAll('.seek-pin');
        pinElements.forEach(pinEl => {
            const pinPct = parseFloat(pinEl.dataset.pct);
            const pinX = (pinPct / 100) * rect.width;
            const dist = Math.abs(pinX - mouseX);
            if (dist < minPixelDist) {
                minPixelDist = dist;
                closestPin = pinEl;
            }
        });

        // Threshold in pixels to snap focus to a milestone pin
        const PIN_SNAP_DISTANCE = 11;

        if (closestPin && minPixelDist <= PIN_SNAP_DISTANCE) {
            if (activeHoverPin !== closestPin) {
                if (activeHoverPin) activeHoverPin.classList.remove('pin-hover');
                closestPin.classList.add('pin-hover');
                activeHoverPin = closestPin;
            }
            seekHoverTooltip.classList.remove('active');
        } else {
            if (activeHoverPin) {
                activeHoverPin.classList.remove('pin-hover');
                activeHoverPin = null;
            }

            const turnNum = frame?.turnNumber ?? 1;
            seekHoverTooltip.textContent = `第 ${hoverFrameIdx + 1} 幀 (T${turnNum})`;
            seekHoverTooltip.style.left = `${clampedMouseX + 7}px`;

            if (clampedMouseX < 45) {
                seekHoverTooltip.style.transform = 'translateX(0)';
            } else if (rect.width - clampedMouseX < 45) {
                seekHoverTooltip.style.transform = 'translateX(-100%)';
            } else {
                seekHoverTooltip.style.transform = 'translateX(-50%)';
            }

            seekHoverTooltip.classList.add('active');
        }
    };

    seekTrackWrapper.onpointerleave = () => {
        if (activeHoverPin) {
            activeHoverPin.classList.remove('pin-hover');
            activeHoverPin = null;
        }
        seekHoverTooltip.classList.remove('active');
    };

    seekTrackWrapper.addEventListener('click', (e) => {
        if (activeHoverPin) {
            const frameIdx = parseInt(activeHoverPin.dataset.frameIndex, 10);
            if (!isNaN(frameIdx)) {
                e.stopPropagation();
                jumpToFrame(frameIdx);
            }
        }
    }, true);

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

    const speedBtn = document.createElement('button');
    speedBtn.id = 'btn-speed';
    speedBtn.textContent = `速度: ${engineState.playbackSpeed}x`;
    speedBtn.onclick = () => {
        const currentIdx = PLAYBACK_SPEEDS.indexOf(engineState.playbackSpeed);
        const nextIndex = (currentIdx === -1 ? 0 : currentIdx + 1) % PLAYBACK_SPEEDS.length;
        const nextSpeed = setPlaybackSpeed(PLAYBACK_SPEEDS[nextIndex]);
        speedBtn.textContent = `速度: ${nextSpeed}x`;
    };

    let wasPlayingBeforeDrag = false;

    seekRange.onpointerdown = () => {
        wasPlayingBeforeDrag = engineState.isPlaying;
        if (engineState.isPlaying) {
            engineState.isPlaying = false;
            nextPlaybackToken();
            playBtn.textContent = '播放';
        }
    };

    seekRange.oninput = (e) => {
        const targetFrame = Number(e.target.value);
        engineState.currentFrameIndex = targetFrame;
        seekLabel.textContent = formatSeekLabelText(targetFrame);
        engineState.currentCombo = createEmptyCombo();
        nextPlaybackToken();

        if (playBtn.textContent === '重新播放') {
            playBtn.textContent = '播放';
        }
        syncStageToAbsoluteState(targetFrame, false, true);
    };

    seekRange.onchange = (e) => {
        const targetFrame = Number(e.target.value);
        engineState.currentFrameIndex = targetFrame;
        seekLabel.textContent = formatSeekLabelText(targetFrame);
        engineState.currentCombo = createEmptyCombo();

        if (wasPlayingBeforeDrag) {
            wasPlayingBeforeDrag = false;
            syncStageToAbsoluteState(targetFrame, false, false);
            engineState.isPlaying = true;
            playBtn.textContent = '暫停';
            const token = nextPlaybackToken();
            playbackLoop(token);
        } else {
            syncStageToAbsoluteState(targetFrame, false, true);
        }
    };

    seekContainer.appendChild(seekTrackWrapper);
    seekContainer.appendChild(seekLabel);

    const skipBtn = document.createElement('button');
    skipBtn.id = 'btn-skip';
    skipBtn.className = 'btn-skip';
    skipBtn.textContent = '跳過';
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

    const versionTag = document.createElement('span');
    versionTag.className = 'version-tag';
    versionTag.textContent = `v${APP_VERSION}`;
    versionTag.title = `MDBattle-Visualizer v${APP_VERSION}`;

    controls.appendChild(playBtn);
    controls.appendChild(speedBtn);
    controls.appendChild(seekContainer);
    controls.appendChild(skipBtn);
    controls.appendChild(versionTag);

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
            <div class="actor-name" title="${escapeHtml(actor.name)}">${escapeHtml(actor.name)}</div>
            <div class="avatar-wrapper">
                <img class="avatar" src="${escapeHtml(actor.avatar)}" onerror="this.src='${DEFAULT_AVATAR_URL}'">
                <div class="status-tray" id="status-tray-${escapeHtml(actor.id)}"></div>
            </div>
            <div class="hp-container"${hpContainerStyle} id="hp-container-${escapeHtml(actor.id)}">
                <div class="hp-fill" id="hp-fill-${escapeHtml(actor.id)}"></div>
                <div class="hp-text" id="hp-text-${escapeHtml(actor.id)}">${hpTextContent}</div>
            </div>
        `;
        if (actor.side === 'left') leftTeam.appendChild(el);
        else rightTeam.appendChild(el);
    });

    arena.appendChild(leftTeam);
    arena.appendChild(rightTeam);

    const updateLayout = () => {
        updateDynamicTeamLayout(arena, leftTeam, rightTeam);
    };

    if (typeof ResizeObserver !== 'undefined') {
        const resizeObserver = new ResizeObserver(updateLayout);
        resizeObserver.observe(arena);
        engineState.stageResizeObserver = resizeObserver;
    }

    window.addEventListener('resize', updateLayout);
    engineState.stageResizeHandler = updateLayout;

    requestAnimationFrame(updateLayout);

    const dialogBox = document.createElement('div');
    dialogBox.className = 'dialog-box';
    dialogBox.id = 'dialog-box';

    dialogBox.addEventListener('click', (e) => {
        const selection = window.getSelection ? window.getSelection() : null;
        if (selection && selection.toString().trim().length > 0) return;
        const lineEl = e.target.closest('.log-line[data-frame-index]');
        if (!lineEl) return;
        const targetFrame = Number(lineEl.dataset.frameIndex);
        if (Number.isFinite(targetFrame)) {
            if (!engineState.isPlaying && engineState.currentFrameIndex === targetFrame) return;
            jumpToFrame(targetFrame);
        }
    });

    const fatalityOverlay = document.createElement('div');
    fatalityOverlay.id = 'fatality-overlay';
    fatalityOverlay.className = 'fatality-overlay';

    const dragDropOverlay = document.createElement('div');
    dragDropOverlay.className = 'drag-drop-overlay';
    dragDropOverlay.innerHTML = `
        <div class="drag-drop-box">
            <div class="drag-drop-title">放開以載入戰報 JSON</div>
            <div class="drag-drop-sub">支援匯出的 .json 戰報備份檔或原始 API JSON</div>
        </div>
    `;

    stage.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        dragDropOverlay.classList.add('active');
    });

    stage.addEventListener('dragleave', (e) => {
        if (!stage.contains(e.relatedTarget)) {
            dragDropOverlay.classList.remove('active');
        }
    });

    stage.addEventListener('drop', async (e) => {
        e.preventDefault();
        dragDropOverlay.classList.remove('active');
        const file = e.dataTransfer?.files?.[0];
        if (!file) return;
        try {
            const text = await file.text();
            const parsed = parseImportedReportText(text);
            if (typeof engineState.onImportReport === 'function') {
                await engineState.onImportReport(parsed);
            }
        } catch (err) {
            alert(`戰報拖曳載入失敗：${err.message || '檔案格式錯誤'}`);
        }
    });

    stage.appendChild(controls);
    stage.appendChild(ctbBox);
    stage.appendChild(arena);
    stage.appendChild(dialogBox);
    stage.appendChild(fatalityOverlay);
    stage.appendChild(dragDropOverlay);
    engineState.shadowRoot.appendChild(stage);
    updateLayout();

    const handleKeydown = (e) => {
        if (!engineState.hostElement || !engineState.hostElement.isConnected) return;
        if (e.ctrlKey || e.altKey || e.metaKey) return;
        const activeTag = document.activeElement?.tagName;
        if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT') return;

        // While the full-screen MVP settlement panel is open, disable playback/seek hotkeys
        // so keyboard navigation does not mutate stage playback behind the overlay.
        if (engineState.shadowRoot?.getElementById('mdbv-mvp-panel')) {
            if (e.key === 'Escape') {
                e.preventDefault();
                closeBattleStage();
            }
            return;
        }

        switch (e.key) {
            case ' ':
                e.preventDefault();
                playBtn.click();
                break;
            case 'ArrowLeft':
                e.preventDefault();
                if (e.shiftKey) jumpPrevTurn();
                else jumpToFrame(engineState.currentFrameIndex - 1);
                break;
            case 'ArrowRight':
                e.preventDefault();
                if (e.shiftKey) jumpNextTurn();
                else jumpToFrame(engineState.currentFrameIndex + 1);
                break;
            case 'ArrowUp':
                e.preventDefault();
                jumpPrevTurn();
                break;
            case 'ArrowDown':
                e.preventDefault();
                jumpNextTurn();
                break;
            case '1':
            case '2':
            case '3':
            case '4': {
                e.preventDefault();
                const idx = Number(e.key) - 1;
                if (idx >= 0 && idx < PLAYBACK_SPEEDS.length) {
                    const nextSpeed = setPlaybackSpeed(PLAYBACK_SPEEDS[idx]);
                    speedBtn.textContent = `速度: ${nextSpeed}x`;
                }
                break;
            }
            case 's':
            case 'S':
                e.preventDefault();
                skipBtn.click();
                break;
            case 'e':
            case 'E':
                e.preventDefault();
                exportCurrentBattleReport();
                break;
            case 'o':
            case 'O':
                e.preventDefault();
                if (typeof engineState.onImportReport === 'function') {
                    promptImportBattleReport(engineState.onImportReport);
                }
                break;
            case 'Escape':
                e.preventDefault();
                closeBattleStage();
                break;
            default:
                break;
        }
    };

    engineState.activeKeydownHandler = handleKeydown;
    window.addEventListener('keydown', handleKeydown);

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
/**
 * Packages an entire multi-target Area-of-Effect (AOE) attack sequence into a single unified event.
 * Collects all combat hits (DAMAGE, MISS, BLOCK, COUNTER) and bridges over any intermediate reaction
 * dialogues, emergency heals, checks, and quotes so they do not fracture the sweeping shockwave.
 *
 * @param {number} startIndex - Starting frame index in `engineState.frames`.
 * @returns {{ casterId: string, baseSkill: string, hitFrames: Array<object>, reactionFrames: Array<object>, totalLength: number }|null} Packaged AOE event, or null if not a multi-target AOE.
 */
function collectAOEWaveBatch(startIndex) {
    const first = engineState.frames[startIndex];
    if (
        !first ||
        !first.isAOE ||
        !['DAMAGE', 'MISS', 'BLOCK', 'COUNTER'].includes(first.type)
    ) {
        return null;
    }

    const casterId = first.aoeCasterId || (first.type === 'COUNTER' ? first.targetId : first.actorId);
    const baseSkill = normalizeAOESkillGroup(first.incomingSkillId || first.skillId);

    const hitFrames = [];
    const reactionFrames = [];
    let idx = startIndex;

    while (idx < engineState.frames.length) {
        const cur = engineState.frames[idx];
        if (!cur) break;

        const isHit = ['DAMAGE', 'MISS', 'BLOCK'].includes(cur.type) &&
                      (cur.aoeCasterId === casterId || cur.actorId === casterId) &&
                      normalizeAOESkillGroup(cur.skillId) === baseSkill;

        const isCounter = (cur.type === 'COUNTER' || cur.isCounter) &&
                          (cur.targetId === casterId);

        if (isHit || isCounter) {
            hitFrames.push(cur);
            idx++;
            continue;
        }

        // Check if there are further hits of this same AOE wave ahead
        let hasFurtherHits = false;
        for (let k = idx + 1; k < engineState.frames.length; k++) {
            const ahead = engineState.frames[k];
            if (!ahead) break;

            const aheadIsHit = ['DAMAGE', 'MISS', 'BLOCK'].includes(ahead.type) &&
                               (ahead.aoeCasterId === casterId || ahead.actorId === casterId) &&
                               normalizeAOESkillGroup(ahead.skillId) === baseSkill;
            const aheadIsCounter = (ahead.type === 'COUNTER' || ahead.isCounter) &&
                                   (ahead.targetId === casterId);

            if (aheadIsHit || aheadIsCounter) {
                hasFurtherHits = true;
                break;
            }

            // Stop bridging if another actor initiates an independent active attack
            if (['DAMAGE', 'MISS', 'BLOCK'].includes(ahead.type) &&
                ahead.actorId !== casterId &&
                !ahead.isCounter && ahead.type !== 'COUNTER') {
                break;
            }
            // Stop bridging if this caster performs a different active attack
            if (['DAMAGE', 'MISS', 'BLOCK'].includes(ahead.type) &&
                ahead.actorId === casterId &&
                normalizeAOESkillGroup(ahead.skillId) !== baseSkill) {
                break;
            }
        }

        if (hasFurtherHits) {
            reactionFrames.push(cur);
            idx++;
            continue;
        }

        break;
    }

    if (hitFrames.length < 2) return null;
    return {
        casterId,
        baseSkill,
        hitFrames,
        reactionFrames,
        totalLength: idx - startIndex
    };
}

/**
 * Detects consecutive beneficial party-wide frames (mass HEAL or mass BUFF_APPLY from the same caster)
 * to be rendered simultaneously as an expanding radiant wave.
 *
 * @param {number} startIndex - Starting frame index in `engineState.frames`.
 * @returns {Array<object>} Batch of consecutive radiant party frames (length >= 2), or empty array.
 */
function collectPartyRadiantBatch(startIndex) {
    const first = engineState.frames[startIndex];
    if (
        !first ||
        !['HEAL', 'BUFF_APPLY'].includes(first.type) ||
        first.isCounter ||
        !first.skillId ||
        !first.targetId
    ) {
        return [];
    }

    const casterId = first.actorId;
    const skillId = first.skillId;
    const type = first.type;
    const batch = [first];
    let idx = startIndex + 1;

    while (idx < engineState.frames.length) {
        const cur = engineState.frames[idx];
        if (
            cur &&
            cur.type === type &&
            cur.actorId === casterId &&
            cur.skillId === skillId &&
            !cur.isCounter &&
            cur.targetId
        ) {
            batch.push(cur);
            idx++;
        } else {
            break;
        }
    }

    return batch.length >= 2 ? batch : [];
}

/**
 * Renders a packaged multi-target AOE wave event.
 * Phase 1: Physical Spatial Wavefront Sweep — the crescent shockwave and energy blades sweep across
 * all targets in the wave synchronously/column-by-column without any mid-wave speech interruptions.
 * Phase 2: Post-Wave Reactions — plays all dialogues, quotes, emergency first-aids and check results smoothly
 * after the smoke clears.
 *
 * @param {{ casterId: string, baseSkill: string, hitFrames: Array<object>, reactionFrames: Array<object>, totalLength: number }} aoeBatch - Packaged AOE event payload.
 * @param {number} token - Active playback token.
 * @returns {Promise<void>}
 */
async function renderAOEWaveBatch(aoeBatch, token) {
    const sr = engineState.shadowRoot;
    if (!sr || engineState.playbackToken !== token || !aoeBatch) return;

    const { hitFrames, reactionFrames, casterId } = aoeBatch;
    if (!hitFrames || hitFrames.length === 0) return;

    const arena = sr.getElementById('arena');
    const dialog = sr.getElementById('dialog-box');
    const firstFrame = hitFrames[0];
    const speed = getEffectiveSpeed();

    // 1. Check and play Ultimate Cut-In on the first frame of the AOE wave if applicable
    if (isPrimaryUltimateTriggerFrame(firstFrame)) {
        const actor = engineState.actors.get(firstFrame.actorId);
        const isMultiHitSubFrame =
            ULTIMATE_SUBFRAME_REGEX.test(firstFrame.message.trim()) ||
            firstFrame.rosarioEvent === 'INSCRIBE_CROSS';

        if (actor && actor.lastUltimateTurn !== firstFrame.turnNumber && !isMultiHitSubFrame) {
            if (!shouldDeferUltimateCutIn(firstFrame)) {
                actor.lastUltimateTurn = firstFrame.turnNumber;
                await playUltimateCutIn(firstFrame, sr, token);
                if (engineState.playbackToken !== token) return;
            }
        }
    }

    // 2. Update ATB timeline and bond state
    updateATBUI(firstFrame.turnNumber, false, firstFrame.actorsSummonState);
    syncActorBondVisuals(sr, firstFrame.actorsBondState);
    syncActorStatusAndShieldDOM(sr, firstFrame.actorsStatusState, firstFrame.actorsShieldState, firstFrame.actorsBondState);

    // 3. Compute spatial wavefront positions and schedule column impacts
    const casterSide = engineState.actors.get(casterId)?.side || 'left';
    const targetSide = casterSide === 'left' ? 'right' : 'left';

    const scheduledItems = hitFrames.map((wf, idx) => {
        const isCounter = wf.type === 'COUNTER' || wf.isCounter;
        const defenderId = isCounter ? wf.actorId : wf.targetId;
        const targetEl = defenderId ? sr.getElementById(`actor-${defenderId}`) : null;
        let progressX = 0;

        if (arena && targetEl && arena.getBoundingClientRect && targetEl.getBoundingClientRect) {
            const aRect = arena.getBoundingClientRect();
            const tRect = targetEl.getBoundingClientRect();
            if (aRect && aRect.width > 0 && tRect && tRect.width > 0) {
                const targetCenterX = (tRect.left - aRect.left) + tRect.width / 2;
                const waveOriginX = aRect.width / 2;
                // Pure physical distance from the center-stage wave origin to target
                progressX = Math.abs(targetCenterX - waveOriginX);
            } else {
                progressX = idx * 40;
            }
        } else {
            progressX = idx * 40;
        }

        return { wf, idx, defenderId, targetEl, progressX, isCounter };
    });

    // Sort items by spatial wavefront arrival order
    scheduledItems.sort((a, b) => a.progressX - b.progressX);

    // Group into column buckets: targets in the same column take impact simultaneously
    const COLUMN_TOLERANCE = 32;
    const buckets = [];
    let curBucket = [];
    let lastProgress = -9999;

    for (const item of scheduledItems) {
        if (curBucket.length === 0 || Math.abs(item.progressX - lastProgress) <= COLUMN_TOLERANCE) {
            curBucket.push(item);
            lastProgress = item.progressX;
        } else {
            buckets.push(curBucket);
            curBucket = [item];
            lastProgress = item.progressX;
        }
    }
    if (curBucket.length > 0) buckets.push(curBucket);

    const impactDelayMs = 135;
    const columnCount = Math.max(1, buckets.length);
    const columnStaggerMs = columnCount <= 1 ? 0 : Math.max(65, Math.min(110, Math.round(360 / (columnCount - 1))));

    const targetSchedule = new Map();
    buckets.forEach((bucket, bIdx) => {
        const baseDelay = impactDelayMs + bIdx * columnStaggerMs;
        bucket.forEach((item, inBucketIdx) => {
            const hitDelay = baseDelay + inBucketIdx * 6;
            targetSchedule.set(item.wf.index, hitDelay);
        });
    });

    const maxHitDelay = buckets.length > 0 ? (impactDelayMs + (buckets.length - 1) * columnStaggerMs) : impactDelayMs;
    const totalSweepDurationMs = maxHitDelay + 280;

    // Launch caster center-stage animation, crescent sweep wave, and synchronized projectile fan
    const { shadowColor } = playAOEWaveBatchChoreography(hitFrames, sr, targetSchedule);

    const hasCritShake = hitFrames.some(wf => wf.vfx.includes('screen-shake'));
    if (hasCritShake && arena) {
        setTimeout(() => {
            if (engineState.playbackToken === token && arena.isConnected) {
                arena.animate([
                    { transform: 'translateX(0)' },
                    { transform: 'translateX(-8px)', offset: 0.2 },
                    { transform: 'translateX(8px)', offset: 0.4 },
                    { transform: 'translateX(-8px)', offset: 0.6 },
                    { transform: 'translateX(8px)', offset: 0.8 },
                    { transform: 'translateX(0)', offset: 1 }
                ], { duration: 300 / speed, easing: 'ease-in-out' });
            }
        }, impactDelayMs / speed);
    }

    const waveDeadActorIds = new Set(
        hitFrames.filter(wf => wf.isDeathEvent && wf.deadActorId).map(wf => wf.deadActorId)
    );

    // 4. Schedule spatial wavefront impacts across all wave targets
    scheduledItems.forEach((item) => {
        const { wf, targetEl } = item;
        const hitDelay = (targetSchedule.get(wf.index) || impactDelayMs) / speed;
        setTimeout(() => {
            if (engineState.playbackToken !== token || !engineState.hostElement?.isConnected) return;

            if (wf.message && dialog) {
                if (dialog.lastElementChild?.dataset?.frameIndex !== String(wf.index)) {
                    const msgEl = createLogLineElement(wf);
                    dialog.appendChild(msgEl);
                    dialog.scrollTop = dialog.scrollHeight;
                }
            }

            const lookahead = lookaheadComboState(wf.index, wf);
            advanceComboState(wf, lookahead.isNextFrameSameCombo);
            renderComboBanner(arena, wf, speed);

            const thisTargetSide = engineState.actors.get(item.defenderId)?.side || targetSide;
            if (targetEl && arena) {
                triggerAOETargetImpact(wf, arena, targetEl, thisTargetSide, shadowColor, speed);
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

    // Wait for physical shockwave sweep across all targets to finish
    await new Promise(resolve => setTimeout(resolve, totalSweepDurationMs / speed));
    if (engineState.playbackToken !== token) return;

    // 5. PHASE 2: Play after-wave reactions (dialogues, speech bubbles, emergency saves, time rewinds)
    if (reactionFrames && reactionFrames.length > 0) {
        for (const rf of reactionFrames) {
            if (engineState.playbackToken !== token || !engineState.isPlaying) return;

            if (rf.message && dialog) {
                if (dialog.lastElementChild?.dataset?.frameIndex !== String(rf.index)) {
                    const msgEl = createLogLineElement(rf);
                    dialog.appendChild(msgEl);
                    dialog.scrollTop = dialog.scrollHeight;
                }
            }

            if (rf.type === 'HEAL') {
                syncActorHpAndDeathDOM(sr, rf, { skipHpTransition: false });
                spawnFloatingText(rf, sr, false, false);
            }
            if (rf.type === 'BUFF_APPLY') {
                syncActorStatusAndShieldDOM(sr, rf.actorsStatusState, rf.actorsShieldState, rf.actorsBondState);
                spawnFloatingText(rf, sr, false, false);
            }
            if (['DICE', 'STATUS', 'SKILL_TEXT', 'BUFF_APPLY', 'DEBUFF_APPLY'].includes(rf.type) || rf.diceRoll) {
                spawnStatusOrDiceBadge(rf, sr);
            }

            const speaker = resolveDialogueSpeaker(rf);
            if (speaker && !isUltimateCutInQuoteFrame(rf)) {
                smoothlyReturnDisplacedActorsToOrigin(sr);
                const readTime = renderSpeechBubble(rf, sr, token);
                const textDuration = getMessageReadingDuration(speaker.quote);
                const waitMs = Math.max(textDuration, readTime, 400);
                await new Promise(resolve => setTimeout(resolve, waitMs / speed));
            } else if (isSceneNarrationFrame(rf)) {
                smoothlyReturnDisplacedActorsToOrigin(sr);
                const readTime = renderSceneNarrationBanner(rf, sr, token);
                const textDuration = getMessageReadingDuration(rf.message);
                const waitMs = Math.max(textDuration, readTime, 400);
                await new Promise(resolve => setTimeout(resolve, waitMs / speed));
            } else if (rf.type === 'TEXT' || rf.type === 'SKILL_TEXT') {
                await new Promise(resolve => setTimeout(resolve, 200 / speed));
            }
        }
    }

    const lastWf = hitFrames[hitFrames.length - 1];
    if (lastWf) {
        syncActorStatusAndShieldDOM(sr, lastWf.actorsStatusState, lastWf.actorsShieldState, lastWf.actorsBondState);
    }

    // 6. Play K.O. fatality sequence for any target(s) defeated during this AOE wave
    for (const wf of hitFrames) {
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
 * Renders a batch of consecutive party-wide HEAL or BUFF_APPLY frames as an expanding radiant wave
 * with synchronized floating numbers and smooth HP/shield updates.
 *
 * @param {Array<object>} waveFrames - Batch of party-wide frames.
 * @param {number} token - Active playback token.
 * @returns {Promise<void>}
 */
async function renderPartyRadiantBatch(waveFrames, token) {
    const sr = engineState.shadowRoot;
    if (!sr || engineState.playbackToken !== token || waveFrames.length === 0) return;

    const arena = sr.getElementById('arena');
    const dialog = sr.getElementById('dialog-box');
    const firstFrame = waveFrames[0];
    const speed = getEffectiveSpeed();

    // 1. Check and play Ultimate Cut-In if this mass skill is an ultimate
    if (isPrimaryUltimateTriggerFrame(firstFrame)) {
        const actor = engineState.actors.get(firstFrame.actorId);
        if (actor && actor.lastUltimateTurn !== firstFrame.turnNumber) {
            actor.lastUltimateTurn = firstFrame.turnNumber;
            await playUltimateCutIn(firstFrame, sr, token);
            if (engineState.playbackToken !== token) return;
        }
    }

    // 2. ATB and status tray updates
    updateATBUI(firstFrame.turnNumber, false, firstFrame.actorsSummonState);
    syncActorBondVisuals(sr, firstFrame.actorsBondState);

    const casterId = firstFrame.actorId;
    const casterEl = sr.getElementById(`actor-${casterId}`);
    const casterSide = engineState.actors.get(casterId)?.side || 'left';
    const isHeal = firstFrame.type === 'HEAL';
    const radiantColor = isHeal ? '#48bb78' : '#4fd1c5';

    // 3. Caster pulse animation and expanding radiant wave
    let waveOriginX = 0;
    let waveOriginY = 0;
    if (arena && casterEl && casterEl.getBoundingClientRect) {
        const aRect = arena.getBoundingClientRect();
        const cRect = casterEl.getBoundingClientRect();
        waveOriginX = (cRect.left - aRect.left) + cRect.width / 2;
        waveOriginY = (cRect.top - aRect.top) + cRect.height / 2;

        casterEl.animate([
            { transform: 'scale(1)', filter: 'brightness(1)' },
            { transform: 'scale(1.15)', filter: `brightness(1.5) drop-shadow(0 0 16px ${radiantColor})`, offset: 0.3 },
            { transform: 'scale(1)', filter: 'brightness(1)', offset: 1 }
        ], { duration: 420 / speed, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
    } else if (arena) {
        const aRect = arena.getBoundingClientRect ? arena.getBoundingClientRect() : { width: 1000, height: 400 };
        waveOriginX = casterSide === 'left' ? aRect.width * 0.25 : aRect.width * 0.75;
        waveOriginY = aRect.height * 0.5;
    }

    if (arena) {
        spawnRadiantPartyWave(arena, waveOriginX, waveOriginY, radiantColor, speed);
    }

    // 4. Staggered target ripple across party members
    const rippleStaggerMs = Math.min(25, Math.max(10, Math.round(240 / waveFrames.length)));
    const baseImpactDelayMs = 120;
    const totalDurationMs = baseImpactDelayMs + (waveFrames.length - 1) * rippleStaggerMs + 340;

    waveFrames.forEach((wf, idx) => {
        const hitDelay = (baseImpactDelayMs + idx * rippleStaggerMs) / speed;
        setTimeout(() => {
            if (engineState.playbackToken !== token || !engineState.hostElement?.isConnected) return;

            if (wf.message && dialog) {
                if (dialog.lastElementChild?.dataset?.frameIndex !== String(wf.index)) {
                    const msgEl = createLogLineElement(wf);
                    dialog.appendChild(msgEl);
                    dialog.scrollTop = dialog.scrollHeight;
                }
            }

            const targetEl = wf.targetId ? sr.getElementById(`actor-${wf.targetId}`) : null;
            if (targetEl) {
                targetEl.animate([
                    { transform: 'scale(1)', filter: 'brightness(1)' },
                    { transform: 'scale(1.08)', filter: `brightness(1.4) drop-shadow(0 0 12px ${radiantColor})`, offset: 0.4 },
                    { transform: 'scale(1)', filter: 'brightness(1)', offset: 1 }
                ], { duration: 300 / speed, easing: 'ease-out' });
            }

            spawnFloatingText(wf, sr, false, false);

            if (isHeal) {
                syncActorHpAndDeathDOM(sr, wf, { skipHpTransition: false });
            }
            syncActorStatusAndShieldDOM(sr, wf.actorsStatusState, wf.actorsShieldState, wf.actorsBondState);
        }, hitDelay);
    });

    await new Promise(resolve => setTimeout(resolve, totalDurationMs / speed));
    if (engineState.playbackToken !== token) return;

    const lastWf = waveFrames[waveFrames.length - 1];
    if (lastWf) {
        syncActorStatusAndShieldDOM(sr, lastWf.actorsStatusState, lastWf.actorsShieldState, lastWf.actorsBondState);
    }
}

/**
 * Main asynchronous playback loop that steps through frames until paused, cancelled, or finished.
 * Automatically batches multi-target AOE wave frames into a fluid sweeping barrage and mass party buffs/heals into radiant waves.
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
        if (aoeBatch && aoeBatch.hitFrames.length >= 2) {
            await renderAOEWaveBatch(aoeBatch, token);
            if (engineState.playbackToken !== token || !engineState.isPlaying) {
                return;
            }
            engineState.currentFrameIndex += aoeBatch.totalLength;
            continue;
        }

        const radiantBatch = collectPartyRadiantBatch(engineState.currentFrameIndex);
        if (radiantBatch.length >= 2) {
            await renderPartyRadiantBatch(radiantBatch, token);
            if (engineState.playbackToken !== token || !engineState.isPlaying) {
                return;
            }
            engineState.currentFrameIndex += radiantBatch.length;
            continue;
        }

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
 * Smoothly returns all displaced combatants back to their initial home positions (0, 0)
 * before dialogue delivery or scene narration subtitle presentations.
 * Uses window.getComputedStyle to detect real-time WAAPI positions, avoiding abrupt 0ms snaps.
 *
 * @param {ShadowRoot} sr - Stage ShadowRoot instance.
 * @param {string|null} [heldActorId=null] - Actor ID currently held in position for cover/combo.
 */
function smoothlyReturnDisplacedActorsToOrigin(sr, heldActorId = null) {
    const effectiveSpeed = getEffectiveSpeed();
    engineState.actors.forEach(actor => {
        if (actor.id === heldActorId) return;
        const el = sr.getElementById(`actor-${actor.id}`);
        if (!el || el.classList.contains('spawning') || el.classList.contains('despawning')) return;

        const anims = el.getAnimations ? el.getAnimations() : [];
        const computedTransform = window.getComputedStyle ? window.getComputedStyle(el).transform : el.style.transform;
        const isDisplaced =
            (computedTransform && computedTransform !== 'none' && computedTransform !== 'matrix(1, 0, 0, 1, 0, 0)') ||
            (el.style.transform && el.style.transform !== 'none');

        if (isDisplaced) {
            anims.forEach(anim => anim.cancel());
            el.animate([
                { transform: computedTransform },
                { transform: 'translate(0px, 0px) scale(1)' }
            ], {
                duration: 220 / effectiveSpeed,
                easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
                fill: 'none'
            }).onfinish = () => {
                el.style.transform = '';
            };
        } else {
            anims.forEach(anim => anim.cancel());
            el.style.transform = '';
        }
    });
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
            summonedEl.classList.remove('unspawned', 'despawning', 'dead');
            summonedEl.classList.add('spawning');
            setTimeout(() => {
                if (engineState.playbackToken === token && summonedEl.isConnected) {
                    summonedEl.classList.remove('spawning');
                }
            }, 550 / getEffectiveSpeed());
        }
        const arena = sr.getElementById('arena');
        const leftTeam = arena?.querySelector('.left-team');
        const rightTeam = arena?.querySelector('.right-team');
        if (arena && leftTeam) updateDynamicTeamLayout(arena, leftTeam, rightTeam);
    }

    if (frame.isDespawnEvent && (frame.despawnedActorIds?.length || frame.despawnedActorId)) {
        const despawnIds = frame.despawnedActorIds?.length ? frame.despawnedActorIds : [frame.despawnedActorId];
        despawnIds.forEach(id => {
            const despawnedEl = sr.getElementById(`actor-${id}`);
            if (despawnedEl) {
                despawnedEl.classList.remove('spawning');
                despawnedEl.classList.add('despawning');
                setTimeout(() => {
                    if (engineState.playbackToken === token && despawnedEl.isConnected) {
                        despawnedEl.classList.remove('despawning');
                        despawnedEl.classList.add('unspawned');
                        const arena = sr.getElementById('arena');
                        const leftTeam = arena?.querySelector('.left-team');
                        const rightTeam = arena?.querySelector('.right-team');
                        if (arena && leftTeam) updateDynamicTeamLayout(arena, leftTeam, rightTeam);
                    }
                }, 550 / getEffectiveSpeed());
            }
        });
    }

    if (frame.isSummonEvent || frame.isDespawnEvent) {
        frameDuration = Math.max(frameDuration, 750);
    }

    // 3. Render speech bubble for dialogue (only on resolved on-field speaker) OR scene narration subtitle banner
    const speaker = resolveDialogueSpeaker(frame);
    if (speaker) {
        // Ensure all combatants return smoothly to home positions before speaking (do not stick to enemies or snap)
        smoothlyReturnDisplacedActorsToOrigin(sr, engineState.currentCombo.heldForCoverActorId);
        if (!isUltimateCutInQuoteFrame(frame)) {
            const readTime = renderSpeechBubble(frame, sr, token);
            const textDuration = getMessageReadingDuration(speaker.quote);
            frameDuration = Math.max(frameDuration, textDuration, readTime);
        }
    } else if (isSceneNarrationFrame(frame)) {
        // Ensure all combatants are in their home positions during scene narration
        smoothlyReturnDisplacedActorsToOrigin(sr, engineState.currentCombo.heldForCoverActorId);
        const readTime = renderSceneNarrationBanner(frame, sr, token);
        const textDuration = getMessageReadingDuration(frame.message);
        frameDuration = Math.max(frameDuration, textDuration, readTime);
    }

    // 4. Play environmental field pulse on battlefield hazards or altar waves
    if (frame.isEnvironmentalPulse && frame.type === 'TEXT') {
        playEnvironmentalFieldPulse(frame, sr);
        frameDuration = Math.max(frameDuration, 1100);
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
            if (!shouldDeferUltimateCutIn(frame)) {
                actor.lastUltimateTurn = frame.turnNumber;
                await playUltimateCutIn(frame, sr, token);
                if (engineState.playbackToken !== token) return;
            }
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
        arena.animate([
            { transform: 'translateX(0)' },
            { transform: 'translateX(-8px)', offset: 0.2 },
            { transform: 'translateX(8px)', offset: 0.4 },
            { transform: 'translateX(-8px)', offset: 0.6 },
            { transform: 'translateX(8px)', offset: 0.8 },
            { transform: 'translateX(0)', offset: 1 }
        ], { duration: 300 / getEffectiveSpeed(), easing: 'ease-in-out' });
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
                frameDuration = Math.max(frameDuration, 750);
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
    syncActorStatusAndShieldDOM(sr, frame.actorsStatusState, frame.actorsShieldState, frame.actorsBondState);

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