// ==========================================
// FILE: src/choreography.js
// ==========================================
/**
 * @fileoverview Web Animations API physical movement choreography for the battle stage.
 * Handles center-stage AOE waves, single-target melee/ranged lunges, mid-combo counters,
 * shield blocks, dodges, character-specific strike VFX, and 3-actor bridal cover interceptions.
 */

import { engineState, getEffectiveSpeed } from './state.js';
import {
    getSkillChoreographyProfile,
    getCrossFinisherProfile
} from './profiles.js';
import {
    lookaheadComboState,
    advanceComboState,
    hasMoreHitsOnSameTargetInTurn,
    renderComboBanner
} from './combo.js';

export { lookaheadComboState, advanceComboState };

/**
 * Spawns a radial impact clash spark over a target element after a specified delay.
 *
 * @param {HTMLElement} arena - Stage `#arena` element.
 * @param {HTMLElement} anchorEl - Element where the spark is centered.
 * @param {number} [delay=120] - Unscaled delay in milliseconds before the spark appears.
 * @param {string} [color='#f6e05e'] - Primary radial glow color.
 * @param {number} [speed=1] - Effective playback speed multiplier.
 */
function spawnClashSpark(arena, anchorEl, delay = 120, color = '#f6e05e', speed = 1) {
    setTimeout(() => {
        if (!anchorEl.isConnected || !arena.isConnected) return;
        const sparkEl = document.createElement('div');
        sparkEl.style.cssText = `position: absolute; width: 70px; height: 70px; background: radial-gradient(circle, #ffffff 20%, ${color} 50%, transparent 80%); border-radius: 50%; z-index: 20; transform: translate(-50%, -50%) scale(0); pointer-events: none; mix-blend-mode: screen; box-shadow: 0 0 20px ${color};`;
        const tRect = anchorEl.getBoundingClientRect();
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
}

/**
 * Spawns a sweeping crescent AOE shockwave arc that expands from the caster toward the target team.
 *
 * @param {HTMLElement} arena - Stage `#arena` element.
 * @param {number} startX - Origin X coordinate relative to `#arena`.
 * @param {number} startY - Origin Y coordinate relative to `#arena`.
 * @param {'left'|'right'} targetSide - Side of the team being swept by the wave.
 * @param {string} color - Primary glow color of the shockwave.
 * @param {number} speed - Effective playback speed multiplier.
 */
export function spawnAOEFanWave(arena, startX, startY, targetSide, color = '#fc8181', speed = 1) {
    if (!arena || !arena.isConnected) return;
    const waveEl = document.createElement('div');
    const dirClass = targetSide === 'right' ? 'wave-right' : 'wave-left';
    waveEl.className = `aoe-fan-wave ${dirClass}`;
    waveEl.style.setProperty('--wave-color', color);
    waveEl.style.left = `${startX}px`;
    waveEl.style.top = `${startY}px`;
    arena.appendChild(waveEl);

    const arenaRect = arena.getBoundingClientRect();
    const sweepDist = (targetSide === 'right' ? 1 : -1) * Math.max(320, arenaRect.width * 0.55);

    const anim = waveEl.animate([
        { transform: 'translate(-50%, -50%) scale(0.3, 0.45)', opacity: 0.95 },
        { transform: `translate(calc(-50% + ${sweepDist * 0.55}px), -50%) scale(1.25, 1.15)`, opacity: 1, offset: 0.45 },
        { transform: `translate(calc(-50% + ${sweepDist}px), -50%) scale(1.75, 1.45)`, opacity: 0, offset: 1 }
    ], {
        duration: 420 / speed,
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)'
    });
    anim.onfinish = () => waveEl.remove();
}

/**
 * Spawns an expanding radiant circular aura wave for party-wide mass heals and mass buffs.
 *
 * @param {HTMLElement} arena - Stage `#arena` element.
 * @param {number} centerX - Origin X coordinate relative to `#arena`.
 * @param {number} centerY - Origin Y coordinate relative to `#arena`.
 * @param {string} color - Primary radiant glow color.
 * @param {number} speed - Effective playback speed multiplier.
 */
export function spawnRadiantPartyWave(arena, centerX, centerY, color = '#48bb78', speed = 1) {
    if (!arena || !arena.isConnected) return;
    const waveEl = document.createElement('div');
    waveEl.className = 'radiant-party-wave';
    waveEl.style.setProperty('--radiant-color', color);
    waveEl.style.left = `${centerX}px`;
    waveEl.style.top = `${centerY}px`;
    arena.appendChild(waveEl);

    const anim = waveEl.animate([
        { transform: 'translate(-50%, -50%) scale(0.15)', opacity: 0.95 },
        { transform: 'translate(-50%, -50%) scale(1.15)', opacity: 0.85, offset: 0.6 },
        { transform: 'translate(-50%, -50%) scale(1.5)', opacity: 0, offset: 1 }
    ], {
        duration: 500 / speed,
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)'
    });
    anim.onfinish = () => waveEl.remove();
}

/**
 * Spawns a directed energy projectile / sword beam flying from the caster to a target card.
 *
 * @param {HTMLElement} arena - Stage `#arena` element.
 * @param {number} startX - Origin X coordinate relative to `#arena`.
 * @param {number} startY - Origin Y coordinate relative to `#arena`.
 * @param {HTMLElement} targetEl - Target actor card element.
 * @param {string} color - Primary projectile glow color.
 * @param {number} delayMs - Unscaled launch delay in milliseconds.
 * @param {number} flightMs - Unscaled flight duration in milliseconds.
 * @param {number} speed - Effective playback speed multiplier.
 */
export function spawnAOEProjectile(arena, startX, startY, targetEl, color = '#fc8181', delayMs = 0, flightMs = 150, speed = 1) {
    setTimeout(() => {
        if (!arena.isConnected || !targetEl || !targetEl.isConnected) return;
        const aRect = arena.getBoundingClientRect();
        const tRect = targetEl.getBoundingClientRect();
        const endX = (tRect.left - aRect.left) + tRect.width / 2;
        const endY = (tRect.top - aRect.top) + tRect.height / 2;

        const angleDeg = Math.atan2(endY - startY, endX - startX) * (180 / Math.PI);
        const projEl = document.createElement('div');
        projEl.className = 'aoe-projectile';
        projEl.style.setProperty('--proj-color', color);
        projEl.style.left = '0px';
        projEl.style.top = '0px';
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
            easing: 'cubic-bezier(0.2, 0.8, 0.4, 1)'
        });
        anim.onfinish = () => projEl.remove();
    }, delayMs / speed);
}

/**
 * Triggers the target impact recoil, shield block flash, or dodge blur and clash spark for an AOE hit.
 *
 * @param {object} frame - Combat frame for the hit target.
 * @param {HTMLElement} arena - Stage `#arena` element.
 * @param {HTMLElement} targetEl - Target actor card element.
 * @param {'left'|'right'} targetSide - Target unit's team side.
 * @param {string} shadowColor - Caster's team-colored glow hex string.
 * @param {number} speed - Effective playback speed multiplier.
 */
export function triggerAOETargetImpact(frame, arena, targetEl, targetSide, shadowColor, speed) {
    if (!targetEl || !targetEl.isConnected) return;
    if (targetEl.getAnimations) targetEl.getAnimations().forEach(anim => anim.cancel());

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
        spawnClashSpark(arena, targetEl, 20, '#63b3ed', speed);
    } else if (frame.type === 'COUNTER' || frame.isCounter) {
        const strikeDir = targetSide === 'left' ? 28 : -28;
        targetEl.animate([
            { transform: 'translate(0,0) scale(1)', filter: 'brightness(1)' },
            { transform: `translate(${strikeDir}px, 0) scale(1.12)`, filter: 'brightness(1.8) drop-shadow(0 0 14px #ecc94b)', offset: 0.3 },
            { transform: 'translate(0,0) scale(1)', filter: 'brightness(1)', offset: 1 }
        ], { duration: 280 / speed, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
        spawnClashSpark(arena, targetEl, 25, '#ecc94b', speed);
    } else {
        targetEl.animate([
            { transform: 'translate(0,0) scale(1)', filter: 'brightness(1)' },
            { transform: `translate(${dodgeDir * 0.55}px, 0) scale(0.92)`, filter: 'brightness(1.85) contrast(1.3)', offset: 0.3 },
            { transform: 'translate(0,0) scale(1)', filter: 'brightness(1)', offset: 1 }
        ], { duration: 260 / speed, easing: 'ease-out' });
        spawnClashSpark(arena, targetEl, 20, shadowColor, speed);
    }
}

/**
 * Orchestrates a unified multi-target AOE wave barrage across a batch of consecutive AOE frames.
 * The caster dashes to center stage once and unleashes a sweeping crescent shockwave plus
 * a rapid staggered fan of projectiles that strike all targets in a fluid spatial wavefront ripple.
 *
 * @param {Array<object>} waveFrames - Consecutive AOE hit frames belonging to the current wave burst.
 * @param {ShadowRoot} sr - Stage ShadowRoot instance.
 * @param {Map<number, number>|null} [targetSchedule=null] - Optional spatial schedule mapping frame indices to hit delays.
 * @returns {{ staggerMs: number, impactDelayMs: number, totalDurationMs: number, shadowColor: string }}
 */
export function playAOEWaveBatchChoreography(waveFrames, sr, targetSchedule = null) {
    const firstFrame = waveFrames[0];
    const lastFrame = waveFrames[waveFrames.length - 1];
    const speed = getEffectiveSpeed();
    const arena = sr.getElementById('arena');
    const casterId = firstFrame.aoeCasterId || (firstFrame.type === 'COUNTER' ? firstFrame.targetId : firstFrame.actorId);
    const actorEl = sr.getElementById(`actor-${casterId}`);
    const side = engineState.actors.get(casterId)?.side || 'left';
    const firstDefenderId = firstFrame.type === 'COUNTER' || firstFrame.isCounter ? firstFrame.actorId : firstFrame.targetId;
    const firstTargetSide = engineState.actors.get(firstDefenderId)?.side || (side === 'left' ? 'right' : 'left');
    const shadowColor = side === 'left' ? '#63b3ed' : '#fc8181';

    const staggerMs = 65;
    const impactDelayMs = 135;
    let waveSweepMs;
    if (targetSchedule && targetSchedule.size > 0) {
        const maxScheduled = Math.max(...Array.from(targetSchedule.values()));
        waveSweepMs = maxScheduled + 280;
    } else {
        waveSweepMs = impactDelayMs + Math.max(0, waveFrames.length - 1) * staggerMs + 280;
    }

    if (!arena || !actorEl) {
        return { staggerMs, impactDelayMs, totalDurationMs: waveSweepMs, shadowColor };
    }

    if (actorEl.getAnimations) actorEl.getAnimations().forEach(anim => anim.cancel());

    const arenaRect = arena.getBoundingClientRect();
    const aoeCasterId = firstFrame.aoeCasterId || firstFrame.actorId;
    if (
        engineState.currentCombo.aoeCenterX === undefined ||
        firstFrame.isAOEFirst ||
        engineState.currentCombo.aoeCasterId !== aoeCasterId
    ) {
        const cleanActorRect = actorEl.getBoundingClientRect();
        let calculatedMoveX =
            (arenaRect.left + arenaRect.width / 2) - (cleanActorRect.left + cleanActorRect.width / 2);
        const calculatedDeltaY =
            (arenaRect.top + arenaRect.height / 2) - (cleanActorRect.top + cleanActorRect.height / 2);

        const side = engineState.actors.get(firstFrame.actorId)?.side || 'left';
        if (side === 'right' && calculatedMoveX > 0) calculatedMoveX = -Math.abs(calculatedMoveX);
        else if (side === 'left' && calculatedMoveX < 0) calculatedMoveX = Math.abs(calculatedMoveX);
        const maxDist = arenaRect.width * 0.48;
        calculatedMoveX = Math.max(-maxDist, Math.min(maxDist, calculatedMoveX));

        engineState.currentCombo.aoeCenterX = calculatedMoveX;
        engineState.currentCombo.aoeCenterY = calculatedDeltaY;
        engineState.currentCombo.aoeCasterId = aoeCasterId;
    }

    const cMoveX = engineState.currentCombo.aoeCenterX || 0;
    const cDeltaY = engineState.currentCombo.aoeCenterY || 0;
    const p0 = 'translate(0px, 0px) scale(1)';
    const pCenter = `translate(${cMoveX}px, ${cDeltaY}px) scale(1.22)`;
    const pCenterPulse = `translate(${cMoveX}px, ${cDeltaY}px) scale(1.32)`;

    const startTransform = engineState.currentCombo.atCenterStage ? pCenter : p0;
    if (lastFrame.isAOELast) {
        actorEl.animate([
            { transform: startTransform, zIndex: 10 },
            { transform: pCenterPulse, filter: `brightness(1.3) drop-shadow(0 0 18px ${shadowColor})`, zIndex: 10, offset: 0.22 },
            { transform: pCenter, filter: `drop-shadow(0 0 14px ${shadowColor})`, zIndex: 10, offset: 0.72 },
            { transform: p0, filter: 'none', zIndex: 1, offset: 1 }
        ], {
            duration: waveSweepMs / speed,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            fill: 'none'
        }).onfinish = () => {
            actorEl.style.transform = '';
        };
        engineState.currentCombo.atCenterStage = false;
        engineState.currentCombo.knockedBack = true;
        engineState.currentCombo.aoeCenterX = undefined;
        engineState.currentCombo.aoeCenterY = undefined;
        engineState.currentCombo.aoeCasterId = null;
    } else {
        actorEl.animate([
            { transform: startTransform, zIndex: 10 },
            { transform: pCenterPulse, filter: `brightness(1.3) drop-shadow(0 0 18px ${shadowColor})`, zIndex: 10, offset: 0.3 },
            { transform: pCenter, filter: `drop-shadow(0 0 14px ${shadowColor})`, zIndex: 10, offset: 1 }
        ], {
            duration: waveSweepMs / speed,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            fill: 'forwards'
        }).onfinish = () => {
            actorEl.style.transform = pCenter;
        };
        engineState.currentCombo.atCenterStage = true;
    }

    const centerStageX = arenaRect.width / 2;
    const centerStageY = arenaRect.height / 2;

    // Launch sweeping crescent shockwave toward targets (pure shockwave, no flying projectiles)
    spawnAOEFanWave(arena, centerStageX, centerStageY, firstTargetSide, shadowColor, speed);

    return { staggerMs, impactDelayMs, totalDurationMs: waveSweepMs, shadowColor };
}

/**
 * Animates center-stage Area-of-Effect (AOE) casting waves and mid-wave counterattacks.
 * The caster moves to the center of the arena on `isAOEFirst`, pulses on each wave target,
 * and returns to origin on `isAOELast`.
 *
 * @param {object} frame - Active AOE combat frame.
 * @param {HTMLElement} arena - Stage `#arena` element.
 * @param {HTMLElement} actorEl - Acting unit's DOM element.
 * @param {HTMLElement} targetEl - Target unit's DOM element.
 * @param {'left'|'right'} side - Acting unit's team side.
 * @param {'left'|'right'} targetSide - Target unit's team side.
 * @param {string} shadowColor - Team-colored drop-shadow hex string.
 * @param {number} speed - Effective playback speed multiplier.
 * @returns {number} Base frame duration in milliseconds (unscaled).
 */
function playAOEWaveChoreography(frame, arena, actorEl, targetEl, side, targetSide, shadowColor, speed) {
    if (actorEl.getAnimations) actorEl.getAnimations().forEach(anim => anim.cancel());
    if (targetEl.getAnimations) targetEl.getAnimations().forEach(anim => anim.cancel());

    const arenaRect = arena.getBoundingClientRect();

    // Counterattack against an AOE wave: actorEl is the defender, targetEl is the AOE caster
    if (frame.isCounter || frame.type === 'COUNTER') {
        const aoeCasterId = frame.targetId;
        const needsRecalculate =
            frame.isAOEFirst ||
            engineState.currentCombo.aoeCasterId !== aoeCasterId ||
            engineState.currentCombo.aoeCenterX === undefined;

        if (needsRecalculate) {
            const tRect = targetEl.getBoundingClientRect();
            let calculatedMoveX = (arenaRect.left + arenaRect.width / 2) - (tRect.left + tRect.width / 2);
            const calculatedDeltaY = (arenaRect.top + arenaRect.height / 2) - (tRect.top + tRect.height / 2);

            // Boundary clamping: ensure targetEl moves inwards toward center stage, never outwards off-screen
            if (targetSide === 'right' && calculatedMoveX > 0) {
                calculatedMoveX = -Math.abs(calculatedMoveX);
            } else if (targetSide === 'left' && calculatedMoveX < 0) {
                calculatedMoveX = Math.abs(calculatedMoveX);
            }
            const maxDisplacement = arenaRect.width * 0.48;
            calculatedMoveX = Math.max(-maxDisplacement, Math.min(maxDisplacement, calculatedMoveX));

            engineState.currentCombo.aoeCenterX = calculatedMoveX;
            engineState.currentCombo.aoeCenterY = calculatedDeltaY;
            engineState.currentCombo.aoeCasterId = aoeCasterId;
        }

        const cMoveX = engineState.currentCombo.aoeCenterX;
        const cDeltaY = engineState.currentCombo.aoeCenterY;

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
            engineState.currentCombo.aoeCenterX = undefined;
            engineState.currentCombo.aoeCenterY = undefined;
            engineState.currentCombo.aoeCasterId = null;
        } else {
            targetEl.animate([
                { transform: engineState.currentCombo.atCenterStage ? pCasterCenter : 'translate(0,0) scale(1)', zIndex: 10 },
                { transform: pCasterRecoil, zIndex: 10, offset: 0.35 },
                { transform: pCasterCenter, zIndex: 10, offset: 1 }
            ], { duration: 480 / speed, easing: 'ease-out', fill: 'forwards' });
            engineState.currentCombo.atCenterStage = true;
        }

        spawnClashSpark(arena, targetEl, 80, '#f6e05e', speed);
        return 520;
    }

    // Standard single-frame AOE hit: actorEl is the AOE caster, targetEl is the current wave target
    const aoeCasterId = frame.aoeCasterId || frame.actorId;
    const needsRecalculate =
        frame.isAOEFirst ||
        engineState.currentCombo.aoeCasterId !== aoeCasterId ||
        engineState.currentCombo.aoeCenterX === undefined;

    if (needsRecalculate) {
        const cleanActorRect = actorEl.getBoundingClientRect();
        let calculatedMoveX =
            (arenaRect.left + arenaRect.width / 2) - (cleanActorRect.left + cleanActorRect.width / 2);
        const calculatedDeltaY =
            (arenaRect.top + arenaRect.height / 2) - (cleanActorRect.top + cleanActorRect.height / 2);

        if (side === 'right' && calculatedMoveX > 0) calculatedMoveX = -Math.abs(calculatedMoveX);
        else if (side === 'left' && calculatedMoveX < 0) calculatedMoveX = Math.abs(calculatedMoveX);
        const maxDist = arenaRect.width * 0.48;
        calculatedMoveX = Math.max(-maxDist, Math.min(maxDist, calculatedMoveX));

        engineState.currentCombo.aoeCenterX = calculatedMoveX;
        engineState.currentCombo.aoeCenterY = calculatedDeltaY;
        engineState.currentCombo.aoeCasterId = aoeCasterId;
    }

    const cMoveX = engineState.currentCombo.aoeCenterX;
    const cDeltaY = engineState.currentCombo.aoeCenterY;
    const p0 = 'translate(0px, 0px) scale(1)';
    const pCenter = `translate(${cMoveX}px, ${cDeltaY}px) scale(1.2)`;
    const pCenterPulse = `translate(${cMoveX}px, ${cDeltaY}px) scale(1.28)`;

    let frameDuration;
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
        engineState.currentCombo.aoeCenterX = undefined;
        engineState.currentCombo.aoeCenterY = undefined;
        engineState.currentCombo.aoeCasterId = null;
    }

    const aoeAnim = actorEl.animate(actorKeyframes, actorAnimConfig);
    aoeAnim.onfinish = () => {
        actorEl.style.transform = actorAnimConfig.fill === 'forwards' ? pCenter : '';
    };

    const centerStageX = arenaRect.width / 2;
    const centerStageY = arenaRect.height / 2;
    if (frame.isAOEFirst) {
        spawnAOEFanWave(arena, centerStageX, centerStageY, targetSide, shadowColor, speed);
    }
    spawnAOEProjectile(arena, centerStageX, centerStageY, targetEl, shadowColor, 0, 120, speed);
    triggerAOETargetImpact(frame, arena, targetEl, targetSide, shadowColor, speed);

    return frameDuration;
}

/**
 * Animates single-target melee/ranged lunges, mid-combo vibrations, counterattack clashes,
 * shield blocks, standalone pass-through dodges, and character-specific strike embellishments.
 *
 * @param {object} frame - Active single-target combat frame.
 * @param {HTMLElement} arena - Stage `#arena` element.
 * @param {HTMLElement} actorEl - Acting unit's DOM element.
 * @param {HTMLElement} targetEl - Target unit's DOM element.
 * @param {'left'|'right'} side - Acting unit's team side.
 * @param {'left'|'right'} targetSide - Target unit's team side.
 * @param {string} shadowColor - Team-colored drop-shadow hex string.
 * @param {number} speed - Effective playback speed multiplier.
 * @param {boolean} isNextFrameSameCombo - Whether the attacker continues their combo next.
 * @param {boolean} isNextTargetDifferent - Whether the next hit switches to a different target.
 * @param {boolean} shouldReturnToOrigin - Whether the attacker must return home after this hit.
 * @returns {number} Base frame duration in milliseconds (unscaled).
 */
function playSingleTargetChoreography(
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
) {
    if (actorEl.getAnimations) actorEl.getAnimations().forEach(anim => anim.cancel());
    if (targetEl.getAnimations) targetEl.getAnimations().forEach(anim => anim.cancel());

    let frameDuration = 600;
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
        const actorObj = engineState.actors.get(frame.actorId);
        const targetObj = engineState.actors.get(frame.targetId);
        const isSameSide = actorObj && targetObj && actorObj.side === targetObj.side;

        if (isSameSide) {
            // Friendly fire redirection (e.g. Qiankun Danuoyi):
            // Both units are in the same team column.
            // Step slightly inward into the arena (+X for left, -X for right) while lunging toward teammate Y.
            const inwardStep = side === 'left' ? 35 : -35;
            const rawDeltaY = targetRect.top - actorRect.top;
            moveX = (targetRect.left - actorRect.left) + inwardStep;
            deltaY = rawDeltaY === 0 ? 0 : rawDeltaY * 0.75;
        } else {
            moveX = (targetRect.left - actorRect.left) + (side === 'left' ? -60 : 60);
            deltaY = targetRect.top - actorRect.top;
        }

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

    const isFollowedByCover = !!frame.holdPositionForCover;
    const stayAtTarget =
        (isNextFrameSameCombo && !isNextTargetDifferent && !shouldReturnToOrigin) ||
        isFollowedByCover;

    if (isFollowedByCover) {
        engineState.currentCombo.heldForCoverActorId = frame.actorId;
    } else if ((shouldReturnToOrigin || isNextTargetDifferent) && !frame.isCounter && frame.type !== 'COUNTER') {
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

        spawnClashSpark(arena, targetEl, 60, '#f6e05e', speed);
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
            spawnClashSpark(arena, targetEl, 80, '#63b3ed', speed);
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
            spawnClashSpark(arena, targetEl, 40, '#63b3ed', speed);
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
            spawnClashSpark(arena, targetEl, 70, '#63b3ed', speed);
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

    // 1. Declarative custom target reactions (e.g. RAPID_SHAKE / collar-grab)
    const choreoProfile = getSkillChoreographyProfile(frame.skillId);
    if (choreoProfile?.targetReaction === 'RAPID_SHAKE' && frame.type === 'DAMAGE') {
        targetKeyframes = [
            { transform: 'translate(0, 0) rotate(0deg)', filter: 'brightness(1)' },
            { transform: 'translate(-12px, -4px) rotate(-6deg)', filter: 'brightness(1.6)', offset: 0.2 },
            { transform: 'translate(10px, 2px) rotate(5deg)', offset: 0.4 },
            { transform: 'translate(-10px, -2px) rotate(-5deg)', offset: 0.6 },
            { transform: 'translate(8px, 0) rotate(3deg)', offset: 0.8 },
            { transform: 'translate(0, 0) rotate(0deg)', filter: 'brightness(1)', offset: 1 }
        ];
        targetAnimConfig.duration = (choreoProfile.shakeDuration || 420) / speed;
    }

    // 2. Declarative custom attacker glow & clash sparks (e.g. cyber-ninja emerald glow)
    if (choreoProfile?.glowColor && frame.type === 'DAMAGE') {
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

    // 3. Declarative Cross Finisher piercing burst (e.g., Mother's Rosario)
    if (frame.rosarioEvent === 'PIERCE_CROSS') {
        const crossProfile = getCrossFinisherProfile(frame.skillId) || {};
        const primaryColor = crossProfile.crossColor || '#f687b3';
        const secondaryColor = crossProfile.glowColor || '#b794f4';
        spawnClashSpark(arena, targetEl, 60, primaryColor, speed);
        spawnClashSpark(arena, targetEl, 140, secondaryColor, speed);
        const crossEl = targetEl.querySelector('.rosario-cross-mark');
        if (crossEl) {
            crossEl.classList.add('shatter');
            setTimeout(() => {
                if (crossEl.isConnected) crossEl.remove();
            }, 450 / speed);
        }
    } else if (frame.isCounter || frame.type === 'COUNTER') {
        const defenderCrossEl = actorEl.querySelector('.rosario-cross-mark');
        if (defenderCrossEl) {
            defenderCrossEl.classList.add('shatter');
            setTimeout(() => {
                if (defenderCrossEl.isConnected) defenderCrossEl.remove();
            }, 450 / speed);
        }
    }

    const actorAnim = actorEl.animate(actorKeyframes, actorAnimConfig);
    actorAnim.onfinish = () => {
        if (actorAnimConfig.fill === 'forwards') {
            const finalKeyframe = actorKeyframes[actorKeyframes.length - 1];
            if (finalKeyframe && finalKeyframe.transform) {
                actorEl.style.transform = finalKeyframe.transform;
            }
        } else {
            actorEl.style.transform = '';
        }
    };

    if (targetKeyframes.length > 0) {
        const targetAnim = targetEl.animate(targetKeyframes, targetAnimConfig);
        targetAnim.onfinish = () => {
            if (targetAnimConfig.fill === 'forwards') {
                const finalKeyframe = targetKeyframes[targetKeyframes.length - 1];
                if (finalKeyframe && finalKeyframe.transform) {
                    targetEl.style.transform = finalKeyframe.transform;
                }
            } else {
                targetEl.style.transform = '';
            }
        };
    }

    return frameDuration;
}

/**
 * Executes Web Animations API movement choreography for single-target combos, counters, blocks,
 * dodges, and center-stage AOE waves. Also updates the global side combo counter banner.
 *
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

    // Self-inflicted damage or battlefield environmental pulses animate in-place without lunging
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

    advanceComboState(frame, isNextFrameSameCombo);

    if (!frame.isCounter && frame.type !== 'COUNTER') {
        renderComboBanner(arena, frame, speed);
    }

    const actorEl = sr.getElementById(`actor-${frame.actorId}`);
    const targetEl = frame.targetId ? sr.getElementById(`actor-${frame.targetId}`) : null;

    if (actorEl && targetEl) {
        const side = engineState.actors.get(frame.actorId)?.side || 'left';
        const targetSide = engineState.actors.get(frame.targetId)?.side || 'right';
        const shadowColor = side === 'left' ? '#fc8181' : '#4fd1c5';

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

/**
 * Animates an actor dashing in front of an allied target to intercept an enemy attack,
 * complete with enemy strike follow-through, clash spark, and knockback recoil.
 *
 * @param {object} frame - Active cover combat frame (`frame.isCoverEvent === true`).
 * @param {ShadowRoot} sr - Stage ShadowRoot instance.
 * @returns {number} Base frame duration in milliseconds (unscaled).
 */
export function playCoverAnimation(frame, sr) {
    const speed = getEffectiveSpeed();
    const arena = sr.getElementById('arena');
    const actorEl = sr.getElementById(`actor-${frame.actorId}`);
    const targetEl = frame.targetId ? sr.getElementById(`actor-${frame.targetId}`) : null;
    const attackerEl = frame.coverAttackerId ? sr.getElementById(`actor-${frame.coverAttackerId}`) : null;

    if (!actorEl || !targetEl || actorEl === targetEl) return 500;

    const wasHeldAtTarget =
        !!frame.coverAttackerId &&
        engineState.currentCombo.heldForCoverActorId === frame.coverAttackerId;
    advanceComboState(frame, false);

    // Cancel active animations first so getBoundingClientRect() measures clean origin positions
    if (actorEl.getAnimations) actorEl.getAnimations().forEach(anim => anim.cancel());
    if (targetEl.getAnimations) targetEl.getAnimations().forEach(anim => anim.cancel());
    if (attackerEl && attackerEl.getAnimations) {
        attackerEl.getAnimations().forEach(anim => anim.cancel());
    }

    const side = engineState.actors.get(frame.actorId)?.side || 'left';
    const actorRect = actorEl.getBoundingClientRect();
    const targetRect = targetEl.getBoundingClientRect();

    // Protector intercepts right in front of the protected ally
    const frontOffsetX = side === 'left' ? 44 : -44;
    const moveX = (targetRect.left - actorRect.left) + frontOffsetX;
    const deltaY = targetRect.top - actorRect.top;

    const shieldRing = document.createElement('div');
    shieldRing.className = 'bridal-cover-shield';
    shieldRing.innerHTML = '<span>💍 GUARD</span>';
    actorEl.appendChild(shieldRing);

    if (frame.coverDamage > 0) {
        const dmgEl = document.createElement('div');
        dmgEl.className = 'floating-text';
        dmgEl.style.color = '#fbb6ce';
        dmgEl.textContent = `-${frame.coverDamage}`;
        actorEl.appendChild(dmgEl);
        setTimeout(() => {
            if (dmgEl.isConnected) dmgEl.remove();
        }, 850 / speed);
    }

    // Animate Enemy Attacker pressing the attack into the shield and getting repelled
    if (attackerEl) {
        const attackerSide = engineState.actors.get(frame.coverAttackerId)?.side || (side === 'left' ? 'right' : 'left');
        const attackerRect = attackerEl.getBoundingClientRect();

        const enemyHeldX = (targetRect.left - attackerRect.left) + (attackerSide === 'left' ? -60 : 60);
        const enemyHeldY = targetRect.top - attackerRect.top;
        const enemyClashX = (targetRect.left - attackerRect.left) + (attackerSide === 'left' ? -78 : 78);
        const enemyRecoilX = enemyClashX + (attackerSide === 'left' ? -28 : 28);

        const pEnemyStart = wasHeldAtTarget
            ? `translate(${enemyHeldX}px, ${enemyHeldY}px) scale(1.15)`
            : 'translate(0, 0) scale(1)';

        attackerEl.animate([
            { transform: pEnemyStart, zIndex: 14 },
            {
                transform: `translate(${enemyClashX}px, ${enemyHeldY}px) scale(1.22)`,
                filter: 'brightness(1.45)',
                zIndex: 14,
                offset: 0.25
            },
            {
                transform: `translate(${enemyRecoilX}px, ${enemyHeldY}px) scale(1.06)`,
                filter: 'brightness(1.8) drop-shadow(0 0 12px #f687b3)',
                zIndex: 14,
                offset: 0.45
            },
            { transform: 'translate(0, 0) scale(1)', filter: 'none', zIndex: 1, offset: 1 }
        ], {
            duration: 640 / speed,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
        });

        // Spawn clash spark between Protector and Enemy at the moment of impact
        if (arena) {
            setTimeout(() => {
                if (!actorEl.isConnected || !arena.isConnected) return;
                const sparkEl = document.createElement('div');
                sparkEl.style.cssText = 'position: absolute; width: 80px; height: 80px; background: radial-gradient(circle, #ffffff 25%, #f687b3 55%, transparent 80%); border-radius: 50%; z-index: 25; transform: translate(-50%, -50%) scale(0); pointer-events: none; mix-blend-mode: screen; box-shadow: 0 0 24px #f687b3;';
                const aRect = actorEl.getBoundingClientRect();
                const arRect = arena.getBoundingClientRect();
                const sparkOffsetX = side === 'left' ? aRect.width * 0.85 : aRect.width * 0.15;
                sparkEl.style.left = `${(aRect.left - arRect.left) + sparkOffsetX}px`;
                sparkEl.style.top = `${(aRect.top - arRect.top) + aRect.height / 2}px`;
                arena.appendChild(sparkEl);

                const sparkAnim = sparkEl.animate([
                    { transform: 'translate(-50%, -50%) scale(0) rotate(0deg)', opacity: 1 },
                    { transform: 'translate(-50%, -50%) scale(3.2) rotate(45deg)', opacity: 1, offset: 0.3 },
                    { transform: 'translate(-50%, -50%) scale(4.5) rotate(90deg)', opacity: 0, offset: 1 }
                ], { duration: 320 / speed });
                sparkAnim.onfinish = () => sparkEl.remove();
            }, 140 / speed);
        }
    }

    // Animate Protector dashing in to block and absorbing the recoil
    actorEl.animate([
        { transform: 'translate(0, 0) scale(1)', zIndex: 15 },
        {
            transform: `translate(${moveX}px, ${deltaY}px) scale(1.14)`,
            filter: 'brightness(1.35) drop-shadow(0 0 14px #f687b3)',
            zIndex: 15,
            offset: 0.23
        },
        {
            transform: `translate(${moveX - (side === 'left' ? 12 : -12)}px, ${deltaY}px) scale(1.08)`,
            filter: 'brightness(1.6) drop-shadow(0 0 22px #fbb6ce)',
            zIndex: 15,
            offset: 0.52
        },
        { transform: 'translate(0, 0) scale(1)', filter: 'none', zIndex: 1, offset: 1 }
    ], {
        duration: 640 / speed,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
    });

    // Protected ally recoils slightly behind the protector
    targetEl.animate([
        { transform: 'translate(0, 0) scale(1)' },
        { transform: `translate(${side === 'left' ? -14 : 14}px, 0) scale(0.95)`, offset: 0.3 },
        { transform: `translate(${side === 'left' ? -14 : 14}px, 0) scale(0.95)`, offset: 0.55 },
        { transform: 'translate(0, 0) scale(1)', offset: 1 }
    ], {
        duration: 580 / speed,
        easing: 'ease-out'
    });

    setTimeout(() => {
        if (shieldRing.isConnected) shieldRing.remove();
    }, 620 / speed);

    return 660;
}