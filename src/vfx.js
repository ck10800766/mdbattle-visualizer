// src/vfx.js
import { engineState, getEffectiveSpeed, escapeRegExp } from './state.js';

/**
 * Separates combo hit accumulation (isNextFrameSameCombo) from physical positioning (shouldReturnToOrigin).
 */
export function lookaheadComboState(currentIndex, frame) {
    let isNextFrameSameCombo = false;
    let isNextTargetDifferent = false;
    let shouldReturnToOrigin = false;

    const activeSkillId =
        frame.source === 'DIRECT' && engineState.currentCombo.actorId === frame.actorId
            ? engineState.currentCombo.skillId
            : frame.skillId;

    for (let i = currentIndex + 1; i < engineState.frames.length; i++) {
        const lookahead = engineState.frames[i];

        // If a LUCK_EVENT is coming up next (even if turnNumber changes after it),
        // force the attacker to return to origin so they aren't standing on the target during BREAK!
        if (lookahead.type === 'LUCK_EVENT') {
            shouldReturnToOrigin = true;
            if (lookahead.turnNumber !== frame.turnNumber) break;
            continue;
        }

        if (lookahead.turnNumber !== frame.turnNumber) break;

        if (['HEAL', 'SP_RECOVER', 'SKILL_TEXT', 'BOSS_DIALOGUE', 'SUMMON'].includes(lookahead.type)) {
            shouldReturnToOrigin = true;
            continue;
        }
        if (lookahead.type === 'TEXT' && lookahead.skillTier === 'ultimate') {
            shouldReturnToOrigin = true;
            continue;
        }
        if (lookahead.type === 'BUFF_APPLY' && !lookahead.passiveId && lookahead.targetId === lookahead.actorId) {
            shouldReturnToOrigin = true;
            continue;
        }

        if (['DAMAGE', 'MISS', 'BLOCK', 'COUNTER'].includes(lookahead.type)) {
            if (lookahead.isCounter || lookahead.type === 'COUNTER') continue;
            if (lookahead.isSelfDamage || lookahead.isEnvironmentalPulse) {
                shouldReturnToOrigin = true;
                continue;
            }

            if (lookahead.actorId === frame.actorId) {
                isNextFrameSameCombo = true;
                if (lookahead.targetId !== frame.targetId) {
                    isNextTargetDifferent = true;
                }
                const isDirectProc = lookahead.source === 'DIRECT';
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
        if (lookahead.isCounter || lookahead.type === 'COUNTER') continue;
        if (['DAMAGE', 'MISS', 'BLOCK'].includes(lookahead.type)) {
            return lookahead.actorId === actorId && lookahead.targetId === targetId;
        }
    }
    return false;
}

export async function playFatalitySequence(sr, actorId) {
    const overlay = sr.getElementById('fatality-overlay');
    const actorEl = sr.getElementById(`actor-${actorId}`);
    if (!overlay || !actorEl) return;

    engineState.timeScale = 0.25;
    try {
        const effectiveSpeed = getEffectiveSpeed();
        overlay.classList.add('active');

        const slash = document.createElement('div');
        slash.className = 'fatality-slash';
        const durationSlash = 500 / effectiveSpeed;
        slash.style.animation = `slash-strike ${durationSlash}ms cubic-bezier(0.1, 1, 0.2, 1) forwards`;
        actorEl.appendChild(slash);

        const deathText = document.createElement('div');
        deathText.className = 'fatality-text';
        deathText.textContent = 'K.O.';
        const durationText = 1500 / effectiveSpeed;
        deathText.style.animation = `text-pop ${durationText}ms cubic-bezier(0.1, 1, 0.2, 1) forwards`;
        deathText.style.animationDelay = `${100 / effectiveSpeed}ms`;
        actorEl.appendChild(deathText);

        await new Promise(resolve => setTimeout(resolve, 600 / effectiveSpeed));

        overlay.classList.remove('active');

        setTimeout(() => {
            if (slash.isConnected) slash.remove();
            if (deathText.isConnected) deathText.remove();
        }, 1000);
    } finally {
        engineState.timeScale = 1.0;
    }
}

export async function playUltimateCutIn(frame, sr, token) {
    const actor = engineState.actors.get(frame.actorId);
    if (!actor || engineState.playbackToken !== token) return;

    const arena = sr.getElementById('arena');
    if (!arena) return;

    const overlay = document.createElement('div');
    overlay.className = 'ultimate-overlay active';

    const flash = document.createElement('div');
    flash.className = 'ult-flash';

    const bgImg = document.createElement('img');
    bgImg.src = actor.avatar;
    bgImg.className = 'ultimate-avatar-bg';

    const vignette = document.createElement('div');
    vignette.className = 'ultimate-vignette';

    const textWrapper = document.createElement('div');
    textWrapper.className = `ult-text-wrapper ${actor.side === 'left' ? 'left-side' : 'right-side'}`;

    let mainText = '';
    let subText = '';

    const quoteMatch = frame.message.match(/「(.*?)」/);
    const remainingText = frame.message.replace(actor.name, '').replace(/[：:]?\s*「.*?」\s*/, ' ').trim();

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
                const skillMatchNext = String(nextFrame.message || '').match(/使出了\s*([^，,。！!—\s]+)/);
                if (skillMatchNext) extractedSkillName = skillMatchNext[1];
            }
        }

        if (extractedSkillName) {
            mainText = extractedSkillName;
        } else {
            let rawSkillId = frame.skillId || 'ULTIMATE_SKILL';
            if (rawSkillId.includes('_')) {
                rawSkillId = rawSkillId.substring(rawSkillId.indexOf('_') + 1);
            }
            mainText = rawSkillId.replace(/_/g, ' ').toUpperCase();
        }

        const escapedActorName = escapeRegExp(actor.name);
        let cleanMsg = frame.message.replace(new RegExp(`^${escapedActorName}[：:]?\\s*(的\\s*)?`), '');
        cleanMsg = cleanMsg.replace(/[，,]?\s*會心一擊！?/g, '');
        cleanMsg = cleanMsg.replace(/[，,]?\s*(對\s*.+?\s*)?造成了?\s*\d+\s*點(真實)?傷害！?/g, '');
        cleanMsg = cleanMsg.replace(/^[，,]\s*/, '').trim();

        if (cleanMsg.length > 0 && !/[。！!?.—]$/.test(cleanMsg)) {
            cleanMsg += '……';
        }
        subText = cleanMsg;
    }

    const isEnglish = /[A-Za-z]/.test(mainText);

    const quoteEl = document.createElement('div');
    quoteEl.className = `ult-quote ${isEnglish ? 'lang-en' : 'lang-zh'}`;
    quoteEl.textContent = mainText;

    const flavorEl = document.createElement('div');
    flavorEl.className = 'ult-flavor';
    flavorEl.textContent = subText;

    textWrapper.appendChild(quoteEl);
    if (subText) textWrapper.appendChild(flavorEl);

    overlay.appendChild(flash);
    overlay.appendChild(bgImg);
    overlay.appendChild(vignette);
    overlay.appendChild(textWrapper);
    arena.appendChild(overlay);

    arena.classList.remove('shake-active');
    void arena.offsetWidth;
    arena.classList.add('shake-active');

    const actualDuration = 2500 / getEffectiveSpeed();

    overlay.style.animationDuration = `${actualDuration}ms`;
    flash.style.animationDuration = `${actualDuration}ms`;
    bgImg.style.animationDuration = `${actualDuration}ms`;
    quoteEl.style.animationDuration = `${actualDuration}ms`;
    flavorEl.style.animationDuration = `${actualDuration}ms`;

    return new Promise(resolve => {
        setTimeout(() => {
            if (overlay.isConnected) overlay.remove();
            resolve();
        }, actualDuration);
    });
}

export function renderSpeechBubble(frame, sr, token) {
    const actorEl = sr.getElementById(`actor-${frame.actorId}`);
    const actor = engineState.actors.get(frame.actorId);
    if (!actorEl || !actor) return 0;

    const existingBubble = actorEl.querySelector('.speech-bubble');
    if (existingBubble) existingBubble.remove();

    const bubble = document.createElement('div');
    bubble.className = `speech-bubble ${actor.side === 'left' ? 'left-bubble' : 'right-bubble'}`;

    const textContent = frame.message.replace(/^.+?[：:]\s*/, '');
    const textSpan = document.createElement('span');
    textSpan.className = 'typewriter-text';
    bubble.appendChild(textSpan);
    actorEl.appendChild(bubble);

    const textLength = textContent.length;
    const readTime = Math.max(2000, 1000 + (textLength * 100));

    let charIndex = 0;
    function typeChar() {
        if (engineState.playbackToken !== token || !bubble.isConnected) return;
        if (charIndex < textContent.length) {
            textSpan.textContent += textContent.charAt(charIndex);
            charIndex++;
            setTimeout(typeChar, 30 / getEffectiveSpeed());
        } else {
            textSpan.classList.remove('typewriter-text');
        }
    }

    typeChar();

    setTimeout(() => {
        if (bubble.isConnected) bubble.remove();
    }, (readTime + 500) / getEffectiveSpeed());

    return readTime;
}

export function spawnStatusOrDiceBadge(frame, sr) {
    const targetId = frame.targetId || frame.actorId;
    const actorEl = sr.getElementById(`actor-${targetId}`);
    if (!actorEl) return;

    const dc = frame.diceCheck;
    if (dc) {
        const badge = document.createElement('div');
        badge.className = 'dice-badge';

        if (dc.kind === 'threshold' && dc.dice) {
            const passed = !!dc.isSuccess;
            badge.classList.add(passed ? 'dice-pass' : 'dice-fail');
            badge.textContent = `🎲 ${dc.dice.total} / DC ${dc.dc} (${passed ? 'PASS' : 'FAIL'})`;
        } else if (dc.kind === 'opposed' && dc.left && dc.right) {
            const leftWon = dc.winner === 'LEFT';
            badge.classList.add(leftWon ? 'dice-pass' : 'dice-fail');
            badge.textContent = `⚖️ ${dc.left.total} vs ${dc.right.total}`;
        } else if (dc.kind === 'roll' && dc.dice) {
            badge.classList.add('dice-roll');
            badge.textContent = `🎲 檢定 ${dc.dice.total}`;
        } else {
            return;
        }

        actorEl.appendChild(badge);
        setTimeout(() => {
            if (badge.isConnected) badge.remove();
        }, 1400 / getEffectiveSpeed());
        return;
    }

    if (frame.type === 'FATIGUE' || frame.type === 'FATIGUE_SKIP' || frame.type === 'SILENCED') {
        const badge = document.createElement('div');
        badge.className = 'dice-badge dice-warn';
        if (frame.type === 'SILENCED') {
            badge.textContent = '🤐 魔力受限';
        } else if (frame.type === 'FATIGUE_SKIP' || frame.stage === 'EXHAUSTED') {
            badge.textContent = '🥵 力竭';
        } else {
            badge.textContent = '💦 疲勞';
        }
        actorEl.appendChild(badge);
        setTimeout(() => {
            if (badge.isConnected) badge.remove();
        }, 1200 / getEffectiveSpeed());
    }
}

export function playCombatAnimation(
    frame,
    sr,
    isNextFrameSameCombo,
    isNextTargetDifferent,
    shouldReturnToOrigin
) {
    if (frame.isCounterSetup) {
        return 350;
    }

    let frameDuration = 600;
    const arena = sr.getElementById('arena');
    if (!arena) return frameDuration;

    const speed = getEffectiveSpeed();

    if (frame.isSelfDamage || frame.isEnvironmentalPulse) {
        const targetEl = sr.getElementById(`actor-${frame.targetId}`);
        if (targetEl) {
            targetEl.animate([
                { transform: 'translate(0, 0) scale(1)', filter: 'brightness(1)' },
                { transform: 'translate(0, 6px) scale(0.95)', filter: 'brightness(1.8) sepia(0.8) hue-rotate(-50deg)', offset: 0.3 },
                { transform: 'translate(0, 0) scale(1)', filter: 'brightness(1)', offset: 1 }
            ], { duration: 350 / speed, easing: 'ease-out' });
        }
        return 420;
    }

    const displayDamage = frame.value || frame.actualDamage || 0;

    if (!frame.isCounter && frame.type !== 'COUNTER') {
        if (engineState.currentCombo.lastFrameIndex !== frame.index) {
            if (engineState.currentCombo.actorId === frame.actorId && engineState.currentCombo.keepAlive) {
                engineState.currentCombo.count++;
                engineState.currentCombo.totalDamage = (engineState.currentCombo.totalDamage || 0) + displayDamage;

                if (!engineState.currentCombo.targetDamages) engineState.currentCombo.targetDamages = {};
                engineState.currentCombo.targetDamages[frame.targetId] =
                    (engineState.currentCombo.targetDamages[frame.targetId] || 0) + displayDamage;

                if (!engineState.currentCombo.targetHitCounts) engineState.currentCombo.targetHitCounts = {};
                engineState.currentCombo.targetHitCounts[frame.targetId] =
                    (engineState.currentCombo.targetHitCounts[frame.targetId] || 0) + 1;

                if (engineState.currentCombo.targetId !== frame.targetId) {
                    engineState.currentCombo.targetId = frame.targetId;
                    engineState.currentCombo.moveX = undefined;
                    engineState.currentCombo.deltaY = undefined;
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
                    moveX: undefined,
                    deltaY: undefined,
                    aoeCenterX: undefined,
                    aoeCenterY: undefined,
                    atCenterStage: false,
                    lastFrameIndex: frame.index
                };
            }
            engineState.currentCombo.lastFrameIndex = frame.index;
        }

        if (engineState.currentCombo.count > 1) {
            const actor = engineState.actors.get(frame.actorId);
            const side = actor ? actor.side : 'left';
            const existingCombo = arena.querySelector(`.global-combo-text-${side}`);
            if (existingCombo) existingCombo.remove();

            const comboEl = document.createElement('div');
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
                ${side === 'left' ? 'left: 5vw; right: auto;' : 'right: 5vw; left: auto;'}
            `;

            arena.appendChild(comboEl);
            comboEl.animate([
                { transform: 'scale(1.3) translateX(10px)', opacity: 0 },
                { transform: 'scale(1) translateX(0)', opacity: 1 }
            ], { duration: 150 / speed, easing: 'cubic-bezier(0.175, 0.885, 0.32, 1.275)' });

            setTimeout(() => {
                if (comboEl.isConnected) {
                    const fade = comboEl.animate(
                        [{ opacity: 1 }, { opacity: 0, transform: 'translateY(-20px)' }],
                        { duration: 300 / speed, fill: 'forwards' }
                    );
                    fade.onfinish = () => comboEl.remove();
                }
            }, 1200 / speed);
        }
    }

    const actorEl = sr.getElementById(`actor-${frame.actorId}`);
    const targetEl = frame.targetId ? sr.getElementById(`actor-${frame.targetId}`) : null;

    if (actorEl && targetEl) {
        const side = engineState.actors.get(frame.actorId)?.side || 'left';
        const targetSide = engineState.actors.get(frame.targetId)?.side || 'right';
        const shadowColor = side === 'left' ? '#fc8181' : '#4fd1c5';

        const triggerClashSpark = (delay = 120, color = '#f6e05e') => {
            setTimeout(() => {
                if (!targetEl.isConnected || !arena.isConnected) return;
                const sparkEl = document.createElement('div');
                sparkEl.style.cssText = `position: absolute; width: 70px; height: 70px; background: radial-gradient(circle, #ffffff 20%, ${color} 50%, transparent 80%); border-radius: 50%; z-index: 20; transform: translate(-50%, -50%) scale(0); pointer-events: none; mix-blend-mode: screen; box-shadow: 0 0 20px ${color};`;
                const tRect = targetEl.getBoundingClientRect();
                const aRect = arena.getBoundingClientRect();
                sparkEl.style.left = `${(tRect.left - aRect.left) + tRect.width / 2}px`;
                sparkEl.style.top = `${(tRect.top - aRect.top) + tRect.height / 2}px`;
                arena.appendChild(sparkEl);
                const sparkAnim = sparkEl.animate([
                    { transform: 'translate(-50%, -50%) scale(0) rotate(0deg)', opacity: 1 },
                    { transform: 'translate(-50%, -50%) scale(3) rotate(45deg)', opacity: 1, offset: 0.3 },
                    { transform: 'translate(-50%, -50%) scale(4.2) rotate(90deg)', opacity: 0, offset: 1 }
                ], { duration: 300 / speed });
                sparkAnim.onfinish = () => sparkEl.remove();
            }, delay / speed);
        };

        // =========================================================================
        // AOE CENTER-STAGE ANIMATION (Dashes to arena center instead of each target)
        // =========================================================================
        if (frame.isAOE) {
            if (actorEl.getAnimations) actorEl.getAnimations().forEach(anim => anim.cancel());
            if (targetEl.getAnimations) targetEl.getAnimations().forEach(anim => anim.cancel());

            const arenaRect = arena.getBoundingClientRect();

            // If a defender counters an AOE wave, actorEl is the defender and targetEl is the AOE caster
            if (frame.isCounter || frame.type === 'COUNTER') {
                frameDuration = 520;
                const tRect = targetEl.getBoundingClientRect();
                const cMoveX =
                    engineState.currentCombo.aoeCenterX ??
                    ((arenaRect.left + arenaRect.width / 2) - (tRect.left + tRect.width / 2));
                const cDeltaY =
                    engineState.currentCombo.aoeCenterY ??
                    ((arenaRect.top + arenaRect.height / 2) - (tRect.top + tRect.height / 2));

                engineState.currentCombo.aoeCenterX = cMoveX;
                engineState.currentCombo.aoeCenterY = cDeltaY;

                const aRect = actorEl.getBoundingClientRect();
                const defToCenterX = (arenaRect.left + arenaRect.width / 2) - (aRect.left + aRect.width / 2) + (side === 'left' ? -45 : 45);
                const defToCenterY = (arenaRect.top + arenaRect.height / 2) - (aRect.top + aRect.height / 2);

                const pCasterCenter = `translate(${cMoveX}px, ${cDeltaY}px) scale(1.2)`;
                const pCasterRecoil = `translate(${cMoveX + (targetSide === 'left' ? -20 : 20)}px, ${cDeltaY}px) scale(1.12)`;

                // Countering defender lunges to center stage to strike the AOE caster, then returns home
                actorEl.animate([
                    { transform: 'translate(0,0) scale(1)', zIndex: 12 },
                    { transform: `translate(${defToCenterX}px, ${defToCenterY}px) scale(1.15)`, filter: 'brightness(1.5) drop-shadow(0 0 10px #fc8181)', zIndex: 12, offset: 0.25 },
                    { transform: `translate(${defToCenterX}px, ${defToCenterY}px) scale(1.15)`, zIndex: 12, offset: 0.45 },
                    { transform: 'translate(0,0) scale(1)', zIndex: 1, offset: 1 }
                ], { duration: 480 / speed, easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', fill: 'none' });

                if (frame.isAOELast) {
                    targetEl.animate([
                        { transform: pCasterCenter, zIndex: 10 },
                        { transform: pCasterRecoil, zIndex: 10, offset: 0.3 },
                        { transform: 'translate(0,0) scale(1)', zIndex: 1, offset: 1 }
                    ], { duration: 480 / speed, easing: 'ease-out', fill: 'none' });
                    engineState.currentCombo.atCenterStage = false;
                    engineState.currentCombo.knockedBack = true;
                } else {
                    targetEl.animate([
                        { transform: engineState.currentCombo.atCenterStage ? pCasterCenter : 'translate(0,0) scale(1)', zIndex: 10 },
                        { transform: pCasterRecoil, zIndex: 10, offset: 0.35 },
                        { transform: pCasterCenter, zIndex: 10, offset: 1 }
                    ], { duration: 480 / speed, easing: 'ease-out', fill: 'forwards' });
                    engineState.currentCombo.atCenterStage = true;
                }

                triggerClashSpark(80, '#f6e05e');
                return frameDuration;
            }

            // Standard AOE frame: actorEl is the AOE caster, targetEl is one of the targets
            if (engineState.currentCombo.aoeCenterX === undefined || frame.isAOEFirst) {
                const cleanActorRect = actorEl.getBoundingClientRect();
                engineState.currentCombo.aoeCenterX =
                    (arenaRect.left + arenaRect.width / 2) - (cleanActorRect.left + cleanActorRect.width / 2);
                engineState.currentCombo.aoeCenterY =
                    (arenaRect.top + arenaRect.height / 2) - (cleanActorRect.top + cleanActorRect.height / 2);
            }

            const cMoveX = engineState.currentCombo.aoeCenterX;
            const cDeltaY = engineState.currentCombo.aoeCenterY;
            const p0 = 'translate(0px, 0px) scale(1)';
            const pCenter = `translate(${cMoveX}px, ${cDeltaY}px) scale(1.2)`;
            const pCenterPulse = `translate(${cMoveX}px, ${cDeltaY}px) scale(1.28)`;

            let actorKeyframes = [];
            let actorAnimConfig = { duration: 280 / speed, easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', fill: 'none' };

            if (!engineState.currentCombo.atCenterStage && !frame.isAOELast) {
                // First hit of multi-target AOE: dash to center stage and hold
                frameDuration = 280;
                actorAnimConfig.duration = 260 / speed;
                actorAnimConfig.fill = 'forwards';
                actorKeyframes = [
                    { transform: p0, zIndex: 10 },
                    { transform: pCenterPulse, filter: `drop-shadow(0 0 14px ${shadowColor})`, zIndex: 10, offset: 0.7 },
                    { transform: pCenter, filter: `drop-shadow(0 0 10px ${shadowColor})`, zIndex: 10, offset: 1 }
                ];
                engineState.currentCombo.atCenterStage = true;
            } else if (engineState.currentCombo.atCenterStage && !frame.isAOELast) {
                // Middle hit of AOE: pulse at center stage
                frameDuration = 220;
                actorAnimConfig.duration = 200 / speed;
                actorAnimConfig.fill = 'forwards';
                actorKeyframes = [
                    { transform: pCenter, filter: `drop-shadow(0 0 10px ${shadowColor})`, zIndex: 10 },
                    { transform: pCenterPulse, filter: `drop-shadow(0 0 16px ${shadowColor})`, zIndex: 10, offset: 0.45 },
                    { transform: pCenter, filter: `drop-shadow(0 0 10px ${shadowColor})`, zIndex: 10, offset: 1 }
                ];
            } else {
                // Final hit of AOE (or 1-target AOE): cast at center stage and return home
                frameDuration = 400;
                actorAnimConfig.duration = 380 / speed;
                actorAnimConfig.fill = 'none';
                const startTransform = engineState.currentCombo.atCenterStage ? pCenter : p0;
                actorKeyframes = [
                    { transform: startTransform, zIndex: 10 },
                    { transform: pCenterPulse, filter: `drop-shadow(0 0 16px ${shadowColor})`, zIndex: 10, offset: 0.35 },
                    { transform: p0, filter: 'none', zIndex: 1, offset: 1 }
                ];
                engineState.currentCombo.atCenterStage = false;
                engineState.currentCombo.knockedBack = true;
            }

            actorEl.animate(actorKeyframes, actorAnimConfig);

            // Target reaction during AOE (no attacker Z-slide on MISS!)
            const dodgeDir = targetSide === 'left' ? -24 : 24;
            if (frame.type === 'MISS') {
                targetEl.animate([
                    { transform: 'translate(0,0) scale(1)', filter: 'blur(0px)' },
                    { transform: `translate(${dodgeDir}px, 0) scale(0.88)`, filter: 'blur(2px) brightness(1.5)', offset: 0.35 },
                    { transform: 'translate(0,0) scale(1)', filter: 'blur(0px)', offset: 1 }
                ], { duration: 320 / speed, easing: 'ease-out' });
            } else if (frame.type === 'BLOCK' || frame.blocked) {
                targetEl.animate([
                    { transform: 'translate(0,0) scale(1)', filter: 'brightness(1)' },
                    { transform: `translate(${dodgeDir * 0.3}px, 2px) scale(0.96)`, filter: 'brightness(1.4) drop-shadow(0 0 10px #63b3ed)', offset: 0.35 },
                    { transform: 'translate(0,0) scale(1)', filter: 'brightness(1)', offset: 1 }
                ], { duration: 240 / speed, easing: 'ease-out' });
                triggerClashSpark(40, '#63b3ed');
            } else {
                targetEl.animate([
                    { transform: 'translate(0,0) scale(1)', filter: 'brightness(1)' },
                    { transform: `translate(${dodgeDir * 0.5}px, 0) scale(0.94)`, filter: 'brightness(1.8) contrast(1.3)', offset: 0.3 },
                    { transform: 'translate(0,0) scale(1)', filter: 'brightness(1)', offset: 1 }
                ], { duration: 240 / speed, easing: 'ease-out' });
                triggerClashSpark(40, shadowColor);
            }

            engineState.currentCombo.keepAlive = isNextFrameSameCombo;
            return frameDuration;
        }

        // =========================================================================
        // SINGLE-TARGET COMBAT ANIMATION
        // =========================================================================
        if (actorEl.getAnimations) actorEl.getAnimations().forEach(anim => anim.cancel());
        if (targetEl.getAnimations) targetEl.getAnimations().forEach(anim => anim.cancel());

        let moveX, deltaY;
        if (engineState.currentCombo.count > 1 && engineState.currentCombo.moveX !== undefined && !frame.isCounter && frame.type !== 'COUNTER') {
            moveX = engineState.currentCombo.moveX;
            deltaY = engineState.currentCombo.deltaY;
        } else {
            const actorRect = actorEl.getBoundingClientRect();
            const targetRect = targetEl.getBoundingClientRect();
            moveX = (targetRect.left - actorRect.left) + (side === 'left' ? -60 : 60);
            deltaY = targetRect.top - actorRect.top;

            if (!frame.isCounter && frame.type !== 'COUNTER') {
                engineState.currentCombo.moveX = moveX;
                engineState.currentCombo.deltaY = deltaY;
            }
        }

        const isCombo = engineState.currentCombo.count > 1 || isNextFrameSameCombo;
        const startsFromOrigin =
            engineState.currentCombo.count === 1 ||
            !isCombo ||
            engineState.currentCombo.knockedBack ||
            engineState.currentCombo.targetChangedThisHit;

        if (!frame.isCounter && frame.type !== 'COUNTER') {
            engineState.currentCombo.knockedBack = false;
        }

        const stayAtTarget = isNextFrameSameCombo && !isNextTargetDifferent && !shouldReturnToOrigin;
        if ((shouldReturnToOrigin || isNextTargetDifferent) && !frame.isCounter && frame.type !== 'COUNTER') {
            engineState.currentCombo.knockedBack = true;
        }

        const isFirstHit = startsFromOrigin && stayAtTarget;
        const isMiddleHit = !startsFromOrigin && stayAtTarget;

        const p0 = 'translate(0px, 0px) scale(1)';
        const pTarget = `translate(${moveX}px, ${deltaY}px) scale(1.15)`;
        const pStart = startsFromOrigin ? p0 : pTarget;

        let actorKeyframes = [];
        let targetKeyframes = [];
        const actorAnimConfig = { duration: 400 / speed, easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', fill: 'none' };
        const targetAnimConfig = { duration: 400 / speed, easing: 'ease-out', fill: 'none' };

        if (frame.isCounter || frame.type === 'COUNTER') {
            frameDuration = 600;
            actorAnimConfig.duration = 500 / speed;
            targetAnimConfig.duration = 500 / speed;

            const originalAttackerId = frame.targetId;
            const isMiddleHitCounter =
                engineState.currentCombo.actorId === originalAttackerId &&
                engineState.currentCombo.count > 1;
            const attackerContinuesOnSameTarget = hasMoreHitsOnSameTargetInTurn(
                engineState.currentFrameIndex,
                frame.turnNumber,
                originalAttackerId,
                frame.actorId
            );

            const actorRect = actorEl.getBoundingClientRect();
            const targetRect = targetEl.getBoundingClientRect();
            const attackerToDefenderX = (actorRect.left - targetRect.left) + (targetSide === 'left' ? -60 : 60);
            const attackerToDefenderY = actorRect.top - targetRect.top;

            const pAttackerClash = `translate(${attackerToDefenderX}px, ${attackerToDefenderY}px) scale(1.15)`;
            const pAttackerPushback = `translate(${attackerToDefenderX * 0.2}px, ${attackerToDefenderY * 0.2}px) scale(1.1)`;

            const counterDashX = side === 'left' ? 20 : -20;
            actorKeyframes = [
                { transform: 'translate(0,0) scale(1)', filter: 'brightness(1)', zIndex: 11 },
                { transform: `translate(${counterDashX}px, 0) scale(1.05)`, filter: 'brightness(1.5) drop-shadow(0 0 10px #fc8181)', zIndex: 11, offset: 0.15 },
                { transform: `translate(${counterDashX}px, 0) scale(1.05)`, filter: 'brightness(1.5) drop-shadow(0 0 10px #fc8181)', zIndex: 11, offset: 0.4 },
                { transform: 'translate(0,0) scale(1)', filter: 'brightness(1)', zIndex: 1, offset: 1 }
            ];

            if (!isMiddleHitCounter || !attackerContinuesOnSameTarget) {
                targetKeyframes = [
                    { transform: isMiddleHitCounter ? pAttackerClash : 'translate(0,0) scale(1)', zIndex: 10 },
                    { transform: pAttackerClash, zIndex: 10, offset: 0.15 },
                    { transform: pAttackerClash, zIndex: 10, offset: 0.2 },
                    { transform: 'translate(0,0) scale(1)', zIndex: 1, offset: 1 }
                ];
                engineState.currentCombo.knockedBack = true;
            } else {
                targetKeyframes = [
                    { transform: pAttackerClash, zIndex: 10 },
                    { transform: pAttackerClash, zIndex: 10, offset: 0.15 },
                    { transform: pAttackerPushback, zIndex: 10, offset: 0.5 },
                    { transform: pAttackerClash, zIndex: 10, offset: 1 }
                ];
                targetAnimConfig.fill = 'forwards';
            }

            triggerClashSpark(60, '#f6e05e');
        } else if (frame.type === 'BLOCK' || frame.blocked) {
            const recoilOffset = side === 'left' ? -18 : 18;
            targetKeyframes = [
                { transform: 'translate(0,0) scale(1)', filter: 'brightness(1)' },
                { transform: `translate(${side === 'left' ? 4 : -4}px, 2px) scale(0.97)`, filter: 'brightness(1.4) drop-shadow(0 0 10px #63b3ed)', offset: 0.35 },
                { transform: 'translate(0,0) scale(1)', filter: 'brightness(1)', offset: 1 }
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
                actorAnimConfig.fill = 'forwards';
                triggerClashSpark(80, '#63b3ed');
            } else if (isMiddleHit) {
                frameDuration = 210;
                actorAnimConfig.duration = 190 / speed;
                targetAnimConfig.duration = 190 / speed;
                actorKeyframes = [
                    { transform: pTarget, zIndex: 10 },
                    { transform: `translate(${moveX + recoilOffset}px, ${deltaY + (Math.random() * 12 - 6)}px) scale(1.08)`, zIndex: 10, offset: 0.45 },
                    { transform: pTarget, zIndex: 10, offset: 1 }
                ];
                actorAnimConfig.fill = 'forwards';
                triggerClashSpark(40, '#63b3ed');
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
                triggerClashSpark(70, '#63b3ed');
            }
        } else if (frame.type === 'MISS') {
            const isStandaloneFirstMiss =
                engineState.currentCombo.count === 1 &&
                !isNextFrameSameCombo &&
                !isNextTargetDifferent;

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
                actorAnimConfig.fill = 'none';

                targetKeyframes = [
                    { transform: 'scale(1)', filter: 'blur(0px)' },
                    { transform: 'scale(0.8)', filter: 'blur(3px) brightness(1.5)', offset: 0.3 },
                    { transform: 'scale(1)', filter: 'blur(0px)', offset: 1 }
                ];

                engineState.currentCombo.knockedBack = true;
            } else {
                frameDuration = 420;
                actorAnimConfig.duration = 380 / speed;
                targetAnimConfig.duration = 380 / speed;

                // If switching targets on the next hit, do not overshoot into a Z-slide
                const missReachMultiplier = isNextTargetDifferent ? 1.0 : 1.35;

                if (isFirstHit) {
                    actorKeyframes = [
                        { transform: p0, zIndex: 1 },
                        { transform: `translate(${moveX * missReachMultiplier}px, ${deltaY}px) scale(1.15)`, zIndex: 10, offset: 0.5 },
                        { transform: pTarget, zIndex: 10, offset: 1 }
                    ];
                    actorAnimConfig.fill = 'forwards';
                    targetKeyframes = [
                        { transform: 'scale(1)', filter: 'blur(0px)' },
                        { transform: 'scale(0.8)', filter: 'blur(3px) brightness(1.5)', offset: 0.4 },
                        { transform: 'scale(1)', filter: 'blur(0px)', offset: 1 }
                    ];
                } else if (isMiddleHit) {
                    actorKeyframes = [
                        { transform: pStart, zIndex: 10 },
                        { transform: `translate(${moveX * missReachMultiplier}px, ${deltaY}px) scale(1.15)`, zIndex: 10, offset: 0.5 },
                        { transform: pTarget, zIndex: 10, offset: 1 }
                    ];
                    actorAnimConfig.fill = 'forwards';
                    targetKeyframes = [
                        { transform: 'scale(1)', filter: 'blur(0px)' },
                        { transform: 'scale(0.85)', filter: 'blur(4px) brightness(1.8)', offset: 0.5 },
                        { transform: 'scale(1)', filter: 'blur(0px)', offset: 1 }
                    ];
                } else {
                    actorKeyframes = [
                        { transform: pStart, zIndex: 10 },
                        { transform: `translate(${moveX * missReachMultiplier}px, ${deltaY}px) scale(1.15)`, zIndex: 10, offset: 0.4 },
                        { transform: p0, zIndex: 1, offset: 1 }
                    ];
                    targetKeyframes = [
                        { transform: 'scale(1)', filter: 'blur(0px)' },
                        { transform: 'scale(0.8)', filter: 'blur(3px)', offset: 0.4 },
                        { transform: 'scale(1)', filter: 'blur(0px)', offset: 1 }
                    ];
                }
            }
        } else {
            if (isFirstHit) {
                actorKeyframes = [
                    { transform: p0, zIndex: 1 },
                    { transform: `translate(${side === 'left' ? -20 : 20}px, 0) scale(0.95)`, zIndex: 1, offset: 0.15 },
                    { transform: pTarget, zIndex: 10, offset: 0.8 },
                    { transform: pTarget, zIndex: 10, offset: 1 }
                ];
                actorAnimConfig.fill = 'forwards';
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
                actorAnimConfig.fill = 'forwards';
                actorAnimConfig.duration = 150 / speed;
                frameDuration = 180;

                if (targetEl) {
                    targetEl.style.filter = 'brightness(2) contrast(1.5)';
                    targetEl.style.transform = `translateX(${side === 'left' ? 10 : -10}px)`;
                    setTimeout(() => {
                        if (targetEl.isConnected) {
                            targetEl.style.filter = '';
                            targetEl.style.transform = '';
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

        if (!frame.isCounter && frame.type !== 'COUNTER') {
            engineState.currentCombo.keepAlive = isNextFrameSameCombo;
        }

        actorEl.animate(actorKeyframes, actorAnimConfig);
        if (targetKeyframes.length > 0) {
            targetEl.animate(targetKeyframes, targetAnimConfig);
        }
    }

    return frameDuration;
}

export function spawnFloatingText(frame, sr, isNextFrameSameCombo, isNextTargetDifferent) {
    if (frame.isCounterSetup || frame.type === 'HP_REMAINING' || frame.type === 'EXP_GAIN') return;

    const arena = sr.getElementById('arena');
    if (!arena) return;

    // When a LUCK_EVENT or break-stamp occurs, ensure no actor is lingering on top of another unit
    if (frame.type === 'LUCK_EVENT' || frame.vfx.includes('break-stamp')) {
        engineState.actors.forEach(actor => {
            const el = sr.getElementById(`actor-${actor.id}`);
            if (el && el.getAnimations) {
                el.getAnimations().forEach(anim => anim.cancel());
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
        'DAMAGE', 'BLOCK', 'COUNTER', 'MISS', 'HEAL', 'SP_RECOVER', 'BUFF_EFFECT', 'LUCK_EVENT'
    ].includes(frame.type) || frame.rebirthHeal;

    if (!isActionOrEffectFrame || !affectedEl || frame.vfx.includes('break-stamp')) {
        return;
    }

    const targetHitCount = engineState.currentCombo.targetHitCounts?.[frame.targetId] || 1;
    const isTargetCombo =
        ['DAMAGE', 'BLOCK'].includes(frame.type) &&
        !frame.isCounter &&
        !frame.isSelfDamage &&
        !frame.isEnvironmentalPulse &&
        targetHitCount > 1;

    const isBigHit = targetActor && !targetActor.hideHp && (displayValue >= targetActor.maxHp * 0.15);
    const isCriticalOrBig = (frame.isCrit && !frame.blocked) || isBigHit;

    const arenaRect = arena.getBoundingClientRect();
    const actorRect = affectedEl.getBoundingClientRect();
    const centerX = actorRect.left - arenaRect.left + (actorRect.width / 2);
    const centerY = actorRect.top - arenaRect.top + (actorRect.height / 2);

    const now = performance.now();
    let actorFloats = engineState.floatTracker.get(affectedId) || [];
    actorFloats = actorFloats.filter(f => now < f.expiresAt);

    let finalX = centerX;
    let finalY = centerY - 20;

    if (isTargetCombo && displayValue > 0) {
        const comboAvoidOffset = (targetActor && targetActor.side === 'left') ? 60 : -60;
        finalX += comboAvoidOffset;
        finalY -= 30;
    }

    if (isTargetCombo || isCriticalOrBig || frame.type === 'BUFF_EFFECT' || frame.isBeneficial || frame.blocked) {
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
                    const angle = (dx === 0 && dy === 0) ? Math.random() * Math.PI * 2 : Math.atan2(dy, dx);
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

    actorFloats.push({ x: finalX, y: finalY, expiresAt: now + (hitDuration / getEffectiveSpeed()) });
    engineState.floatTracker.set(affectedId, actorFloats);

    const floatEl = document.createElement('div');
    floatEl.className = 'floating-text';
    floatEl.style.animation = 'none';
    floatEl.style.top = '0px';
    floatEl.style.left = '0px';

    if (frame.type === 'MISS') {
        floatEl.style.color = '#a0aec0';
        floatEl.textContent = 'MISS';
    } else if (frame.vfx.includes('shield-block') || frame.type === 'BLOCK' || frame.blocked) {
        floatEl.classList.add('floating-block');
        floatEl.textContent = displayValue > 0 ? `🛡️ BLOCK -${displayValue}` : '🛡️ BLOCK';
    } else if (displayValue === 0 && !frame.isBeneficial) {
        floatEl.style.color = '#a0aec0';
        floatEl.textContent = 'Immune';
    } else {
        const prefix = frame.isBeneficial ? '+' : '-';
        const targetVal = displayValue;

        if (frame.vfx.includes('flash-green')) {
            floatEl.classList.add('floating-heal');
            floatEl.style.color = '#48bb78';
            floatEl.style.textShadow = '0 0 10px rgba(72, 187, 120, 0.8)';
        } else if (frame.vfx.includes('flash-blue')) {
            floatEl.style.color = '#90cdf4';
            floatEl.style.textShadow = '0 0 10px rgba(99, 179, 237, 0.8)';
        } else if (frame.vfx.includes('flash-purple')) {
            floatEl.style.color = '#b794f4';
        } else if (frame.isCrit) {
            floatEl.style.color = '#f6ad55';
            floatEl.style.textShadow = '0 0 10px rgba(221, 107, 32, 1)';
            floatEl.style.fontSize = '32px';
            floatEl.style.fontStyle = 'italic';
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
    floatEl.style.zIndex = isCriticalOrBig ? '35' : '30';

    const driftAngle = Math.atan2(finalY - centerY, finalX - centerX);
    const driftDistance = 40 + Math.random() * 20;
    const driftX = finalX + Math.cos(driftAngle) * driftDistance;
    const driftY = finalY - 30 + Math.sin(driftAngle) * (driftDistance * 0.5);

    const hitAnim = floatEl.animate([
        { opacity: 1, transform: `translate(calc(${finalX}px - 50%), calc(${finalY}px - 50%)) scale(${hitScale * 1.5})`, offset: 0 },
        { opacity: 1, transform: `translate(calc(${finalX}px - 50%), calc(${finalY}px - 50%)) scale(${hitScale})`, offset: 0.15 },
        { opacity: 1, transform: `translate(calc(${finalX}px - 50%), calc(${finalY}px - 50%)) scale(${hitScale})`, offset: 0.8 },
        { opacity: 0, transform: `translate(calc(${driftX}px - 50%), calc(${driftY}px - 50%)) scale(${hitScale * 0.9})`, offset: 1 }
    ], { duration: hitDuration / getEffectiveSpeed(), fill: 'forwards', easing: 'ease-out' });

    hitAnim.onfinish = () => floatEl.remove();

    if (isTargetCombo && displayValue > 0 && engineState.currentCombo.totalDamage > 0) {
        let cumulativeEl = arena.querySelector(`.cumulative-combo-damage[data-target-id="${affectedId}"]`);

        if (!cumulativeEl) {
            cumulativeEl = document.createElement('div');
            cumulativeEl.className = 'floating-text cumulative-combo-damage';
            cumulativeEl.style.color = '#fc8181';
            cumulativeEl.style.fontSize = '48px';
            cumulativeEl.style.fontStyle = 'italic';
            cumulativeEl.style.textShadow = '0 0 12px rgba(197, 48, 48, 1)';
            cumulativeEl.style.animation = 'none';
            cumulativeEl.style.zIndex = '50';

            const sideOffset = (targetActor && targetActor.side === 'left') ? -90 : 90;
            cumulativeEl.style.left = `${centerX + sideOffset}px`;
            cumulativeEl.style.top = `${centerY - 40}px`;

            cumulativeEl.dataset.targetId = affectedId;
            cumulativeEl.dataset.currentTotal = '0';
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

        const comboScale = Math.min(2.5, 1 + (targetHitCount * 0.12));
        const isTargetLastHit = !isNextFrameSameCombo || isNextTargetDifferent;

        if (cumulativeEl.getAnimations) {
            cumulativeEl.getAnimations().forEach(anim => anim.cancel());
        }

        const baseComboTransform = 'translate(-50%, -50%)';
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

        const comboAnim = cumulativeEl.animate(comboKeyframes, { duration: comboDuration, fill: 'forwards' });
        comboAnim.onfinish = () => {
            if (cumulativeEl.isConnected) cumulativeEl.remove();
        };
    }
}