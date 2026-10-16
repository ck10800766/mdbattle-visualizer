// ==========================================
// FILE: src/floatingText.js
// ==========================================
/**
 * @fileoverview Floating combat numbers (damage, heal, block, miss, immunity) with radial
 * collision avoidance and cumulative per-target combo damage counters.
 */

import { engineState, getEffectiveSpeed } from './state.js';

/**
 * Spawns floating combat numbers (damage, heal, block, miss, immunity) with radial anti-overlap
 * collision avoidance, plus an animated cumulative per-target combo damage counter.
 * @param {object} frame - Active combat frame.
 * @param {ShadowRoot} sr - Stage ShadowRoot instance.
 * @param {boolean} isNextFrameSameCombo - Whether the attacker's combo continues on the next frame.
 * @param {boolean} isNextTargetDifferent - Whether the next hit switches to a different target.
 */
export function spawnFloatingText(frame, sr, isNextFrameSameCombo, isNextTargetDifferent) {
    if (frame.isCounterSetup || frame.type === 'HP_REMAINING' || frame.type === 'EXP_GAIN') return;

    const arena = sr.getElementById('arena');
    if (!arena) return;

    // Ensure no actor remains frozen on top of another unit when a LUCK_EVENT or BREAK! stamp triggers
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

    // Radial collision avoidance to prevent rapid multi-hit numbers from stacking on top of each other
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

    // Render or update the cumulative per-target combo damage counter
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