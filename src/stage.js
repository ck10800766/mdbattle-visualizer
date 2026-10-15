// src/stage.js
import {
    engineState,
    createEmptyCombo,
    getEffectiveSpeed,
    nextPlaybackToken,
    formatLogMessage
} from './state.js';
import { STAGE_STYLES } from './styles.js';
import {
    lookaheadComboState,
    playFatalitySequence,
    playUltimateCutIn,
    renderSpeechBubble,
    spawnStatusOrDiceBadge,
    playCombatAnimation,
    spawnFloatingText
} from './vfx.js';
import { showMVPPanel } from './mvp.js';
import { armSpoilerGuard, releaseSpoilerGuard } from './spoilerGuard.js';

function createLogLineElement(frame) {
    const msgEl = document.createElement('div');
    const isDialogue = frame.type === 'BOSS_DIALOGUE' || frame.type === 'DIALOGUE';
    msgEl.className = `log-line ${isDialogue ? 'dialogue-log' : 'system-log'}`;
    msgEl.dataset.frameIndex = String(frame.index);
    const formattedMsg = formatLogMessage(frame.message, engineState.actors);
    msgEl.innerHTML = `<span style="color:#718096; margin-right:8px;">[${frame.index + 1}]</span> ${formattedMsg}`;
    return msgEl;
}

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
        const speeds = [1, 2, 4, 8];
        const currentIdx = speeds.indexOf(engineState.playbackSpeed);
        const nextIndex = (currentIdx === -1 ? 0 : currentIdx + 1) % speeds.length;
        engineState.playbackSpeed = speeds[nextIndex];
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
        // Reveal underlying page outcomes when user closes the visualizer
        releaseSpoilerGuard();
        if (engineState.hostElement) {
            engineState.hostElement.remove();
            engineState.hostElement = null;
        }
        const originalContent = document.querySelector('.css-1svsvwq');
        if (originalContent) originalContent.style.display = '';
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
        el.innerHTML = `
            <div class="actor-name">${actor.name}</div>
            <div class="avatar-wrapper">
                <img class="avatar" src="${actor.avatar}" onerror="this.src='https://via.placeholder.com/150'">
            </div>
            <div class="hp-container">
                <div class="hp-fill" id="hp-fill-${actor.id}"></div>
                <div class="hp-text" id="hp-text-${actor.id}">${actor.maxHp}/${actor.maxHp}</div>
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

    const originalContent = document.querySelector('.css-1svsvwq');
    if (originalContent) originalContent.style.display = 'none';

    engineState.isPlaying = true;
    updateATBUI(0, true);
    const token = nextPlaybackToken();
    playbackLoop(token);
}

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
            icon.innerHTML = `<img src="${actor.avatar}" onerror="this.src='https://via.placeholder.com/150'">`;
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

export function syncStageToAbsoluteState(frameIndex, isInitialReset = false) {
    const sr = engineState.shadowRoot;
    if (!sr) return;

    engineState.timeScale = 1.0;
    engineState.currentCombo = createEmptyCombo();
    engineState.floatTracker.clear();

    const mvpPanel = sr.getElementById('mdbv-mvp-panel');
    if (mvpPanel) mvpPanel.remove();

    const fatalityOverlay = sr.getElementById('fatality-overlay');
    if (fatalityOverlay) fatalityOverlay.classList.remove('active');

    sr.querySelectorAll(
        '.ultimate-overlay, .speech-bubble, .dice-badge, .floating-text, .combo-text, .luck-drop, .break-stamp, .fatality-slash, .fatality-text'
    ).forEach(el => el.remove());

    engineState.actors.forEach(actor => {
        actor.lastUltimateTurn = null;
        const el = sr.getElementById(`actor-${actor.id}`);
        if (el) {
            if (el.getAnimations) el.getAnimations().forEach(anim => anim.cancel());
            el.style.filter = '';
            el.style.transform = '';
            el.classList.remove('blink-active', 'spawning');
        }
    });

    const dialog = sr.getElementById('dialog-box');
    if (dialog) {
        dialog.innerHTML = '';
        if (!isInitialReset && frameIndex > 0) {
            const fragment = document.createDocumentFragment();
            const limit = Math.min(frameIndex, engineState.frames.length);
            for (let i = 0; i < limit; i++) {
                const f = engineState.frames[i];
                if (f.skillTier === 'ultimate' && ['SKILL_TEXT', 'TEXT', 'DAMAGE'].includes(f.type) && !f.isNormalAttack) {
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
        engineState.actors.forEach(actor => {
            actor.currentHp = actor.maxHp;
            const fillEl = sr.getElementById(`hp-fill-${actor.id}`);
            const textEl = sr.getElementById(`hp-text-${actor.id}`);
            const wrapperEl = sr.getElementById(`actor-${actor.id}`);
            if (fillEl && textEl) {
                fillEl.style.transition = 'none';
                fillEl.style.width = '100%';
                setTimeout(() => { fillEl.style.transition = ''; }, 50);
                textEl.textContent = `${actor.maxHp}/${actor.maxHp}`;
                fillEl.classList.remove('warning', 'danger');
            }
            if (wrapperEl) {
                wrapperEl.classList.remove('dead', 'danger-state', 'spawning');
                if (actor.initiallySpawned === false) wrapperEl.classList.add('unspawned');
                else wrapperEl.classList.remove('unspawned');
            }
        });
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

        const isSpawned = frame.actorsSummonState
            ? frame.actorsSummonState.get(actorId) !== false
            : actor?.initiallySpawned !== false;

        if (wrapperEl) {
            if (!isSpawned) wrapperEl.classList.add('unspawned');
            else wrapperEl.classList.remove('unspawned');
        }

        if (fillEl && textEl && actor) {
            const pct = (currentHp / actor.maxHp) * 100;
            fillEl.style.transition = 'none';
            fillEl.style.width = `${Math.max(0, Math.min(100, pct))}%`;
            setTimeout(() => { fillEl.style.transition = ''; }, 50);

            textEl.textContent = `${Math.round(currentHp)}/${actor.maxHp}`;

            fillEl.classList.remove('warning', 'danger');
            if (wrapperEl) wrapperEl.classList.remove('danger-state');

            if (pct > 0 && pct <= 25) {
                fillEl.classList.add('danger');
                if (wrapperEl) wrapperEl.classList.add('danger-state');
            } else if (pct > 0 && pct <= 50) {
                fillEl.classList.add('warning');
            }

            actor.currentHp = currentHp;

            const isDead = frame.actorsDeathState ? frame.actorsDeathState.get(actorId) : (currentHp <= 0);
            if (isDead && wrapperEl) {
                wrapperEl.classList.add('dead');
                wrapperEl.classList.remove('danger-state');
            } else if (!isDead && wrapperEl) {
                wrapperEl.classList.remove('dead');
            }
        }
    });

    updateATBUI(frame.turnNumber, true, frame.actorsSummonState);
}

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
        // Reveal underlying page outcomes once the last line finishes playing
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

export async function renderFrame(frame, token) {
    const sr = engineState.shadowRoot;
    if (!sr || engineState.playbackToken !== token) return;

    const arena = sr.getElementById('arena');
    const dialog = sr.getElementById('dialog-box');
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
            summonedEl.classList.remove('unspawned');
            summonedEl.classList.add('spawning');
            setTimeout(() => {
                if (summonedEl.isConnected) summonedEl.classList.remove('spawning');
            }, 600);
        }
    }

    if (frame.type === 'BOSS_DIALOGUE' || frame.type === 'DIALOGUE') {
        const readTime = renderSpeechBubble(frame, sr, token);
        frameDuration += readTime;
    }

    if (frame.diceCheck || ['FATIGUE', 'FATIGUE_SKIP', 'SILENCED'].includes(frame.type)) {
        spawnStatusOrDiceBadge(frame, sr);
    }

    updateATBUI(frame.turnNumber, false, frame.actorsSummonState);

    if (frame.skillTier === 'ultimate' && ['SKILL_TEXT', 'TEXT', 'DAMAGE'].includes(frame.type) && !frame.isNormalAttack) {
        const actor = engineState.actors.get(frame.actorId);
        if (actor && actor.lastUltimateTurn !== frame.turnNumber) {
            actor.lastUltimateTurn = frame.turnNumber;
            await playUltimateCutIn(frame, sr, token);
            if (engineState.playbackToken !== token) return;
        }
    }

    const {
        isNextFrameSameCombo,
        isNextTargetDifferent,
        shouldReturnToOrigin
    } = lookaheadComboState(engineState.currentFrameIndex, frame);

    if (frame.actorId && ['DAMAGE', 'MISS', 'COUNTER', 'BLOCK'].includes(frame.type)) {
        frameDuration = playCombatAnimation(
            frame,
            sr,
            isNextFrameSameCombo,
            isNextTargetDifferent,
            shouldReturnToOrigin
        );
    }

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
                if (targetEl.isConnected) targetEl.classList.remove('blink-active');
            }, 300);
        }
    }

    if (frame.targetId) {
        const targetEl = sr.getElementById(`actor-${frame.targetId}`);
        if (targetEl) {
            if (frame.vfx.includes('luck-drop')) {
                const dropEl = document.createElement('div');
                dropEl.className = 'luck-drop';
                dropEl.textContent =
                    frame.message.includes('卡車') ? '🚚' :
                    frame.message.includes('釘子') ? '📌' :
                    frame.message.includes('香蕉皮') ? '🍌' :
                    frame.message.includes('樂高') ? '🧱' :
                    frame.message.includes('比特犬') ? '🐕' :
                    frame.message.includes('飛彈') ? '🚀' :
                    frame.message.includes('落雷') ? '⚡' :
                    frame.message.includes('棒球') ? '⚾' :
                    frame.message.includes('撞到樹') ? '🌳' :
                    frame.message.includes('箭') ? '🏹' :
                    frame.message.includes('小刀') ? '🗡️' :
                    frame.message.includes('隕石') ? '☄️' : '💥';
                targetEl.appendChild(dropEl);
                setTimeout(() => {
                    if (dropEl.isConnected) dropEl.remove();
                }, 1000);
            }
            if (frame.vfx.includes('break-stamp')) {
                const breakEl = document.createElement('div');
                breakEl.className = 'break-stamp';
                breakEl.textContent = 'BREAK!';
                targetEl.appendChild(breakEl);
                setTimeout(() => {
                    if (breakEl.isConnected) breakEl.remove();
                }, 1200);
                frameDuration = 1000;
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

        const isDead = frame.actorsDeathState ? frame.actorsDeathState.get(actorId) : (currentHp <= 0);

        if (fillEl && textEl && actor) {
            const pct = (currentHp / actor.maxHp) * 100;

            fillEl.style.width = `${Math.max(0, Math.min(100, pct))}%`;
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

            actor.currentHp = currentHp;

            if (isDead && wrapperEl) {
                if (!triggeredFatality || deadActorId !== actorId) {
                    wrapperEl.classList.add('dead');
                }
                wrapperEl.classList.remove('danger-state');
            } else if (!isDead && wrapperEl) {
                wrapperEl.classList.remove('dead');
            }
        }
    });

    if (triggeredFatality && deadActorId) {
        await playFatalitySequence(sr, deadActorId);
        if (engineState.playbackToken !== token) return;
        const deadWrapper = sr.getElementById(`actor-${deadActorId}`);
        if (deadWrapper) {
            deadWrapper.classList.add('dead');
        }
    }

    const actualDelay = frameDuration / getEffectiveSpeed();
    await new Promise(resolve => setTimeout(resolve, actualDelay));
}