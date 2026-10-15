// ==========================================
// FILE: src/choreography.js
// ==========================================
import { engineState, getEffectiveSpeed } from './state.js';

/**
 * Inspects upcoming frames in the same turn to decouple combo hit accumulation
 * (`isNextFrameSameCombo`) from physical actor positioning (`shouldReturnToOrigin`).
 * @param {number} currentIndex - Index of the active frame.
 * @param {object} frame - Active frame object.
 * @returns {{ isNextFrameSameCombo: boolean, isNextTargetDifferent: boolean, shouldReturnToOrigin: boolean }}
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

        // Force attacker back to origin before a LUCK_EVENT so they do not overlap the target during BREAK!
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

/**
 * Checks whether the original attacker has additional hits queued against the same defender
 * in the current turn after a mid-combo counterattack occurs.
 * @param {number} currentIndex - Current frame index.
 * @param {number} turnNumber - Current turn number.
 * @param {string} actorId - Original attacker ID.
 * @param {string} targetId - Defender ID.
 * @returns {boolean} True if more hits on the same target follow in this turn.
 */
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

/**
 * Executes Web Animations API movement choreography for single-target combos, counters, blocks,
 * dodges, and center-stage AOE waves. Also updates the global side combo counter banner.
 * @param {object} frame - Active combat frame.
 * @param {ShadowRoot} sr - Stage ShadowRoot instance.
 * @param {boolean} isNextFrameSameCombo - Whether the current attacker continues their combo next.
 * @param {boolean} isNextTargetDifferent - Whether the next hit switches to a different target.
 * @param {boolean} shouldReturnToOrigin - Whether the attacker must return home after this hit.
 * @returns {number} Base frame duration in milliseconds (unscaled).
 */
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

    // Update combo hit & damage state for non-counter offensive actions
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
                    prevMoveX: 0,
                    prevDeltaY: 0,
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

        // -------------------------------------------------------------------------
        // Branch A: Center-Stage AOE Wave Choreography
        // -------------------------------------------------------------------------
        if (frame.isAOE) {
            if (actorEl.getAnimations) actorEl.getAnimations().forEach(anim => anim.cancel());
            if (targetEl.getAnimations) targetEl.getAnimations().forEach(anim => anim.cancel());

            const arenaRect = arena.getBoundingClientRect();

            // Counterattack against an AOE wave: actorEl is the defender, targetEl is the AOE caster
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

            // Standard AOE hit: actorEl is the AOE caster, targetEl is the current wave target
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
            const actorAnimConfig = { duration: 280 / speed, easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', fill: 'none' };

            if (!engineState.currentCombo.atCenterStage && !frame.isAOELast) {
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
                frameDuration = 220;
                actorAnimConfig.duration = 200 / speed;
                actorAnimConfig.fill = 'forwards';
                actorKeyframes = [
                    { transform: pCenter, filter: `drop-shadow(0 0 10px ${shadowColor})`, zIndex: 10 },
                    { transform: pCenterPulse, filter: `drop-shadow(0 0 16px ${shadowColor})`, zIndex: 10, offset: 0.45 },
                    { transform: pCenter, filter: `drop-shadow(0 0 10px ${shadowColor})`, zIndex: 10, offset: 1 }
                ];
            } else {
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

        // -------------------------------------------------------------------------
        // Branch B: Single-Target Combat Choreography
        // -------------------------------------------------------------------------
        if (actorEl.getAnimations) actorEl.getAnimations().forEach(anim => anim.cancel());
        if (targetEl.getAnimations) targetEl.getAnimations().forEach(anim => anim.cancel());

        let moveX;
        let deltaY;
        if (
            engineState.currentCombo.count > 1 &&
            engineState.currentCombo.moveX !== undefined &&
            !frame.isCounter &&
            frame.type !== 'COUNTER'
        ) {
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

                // Avoid overshooting into a Z-slide when switching targets on the next hit
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