// ==========================================
// FILE: src/cinematics.js
// ==========================================
/**
 * @fileoverview Cinematic overlays and narrative UI components.
 * Includes slow-motion K.O. fatalities, full-screen Ultimate Cut-Ins, SAO-styled Contract Cut-Ins,
 * Mother's Rosario cross emblems, typewriter speech bubbles, and overhead dice/status badges.
 */

import { DEFAULT_AVATAR_URL } from './constants.js';
import { engineState, getEffectiveSpeed } from './state.js';
import { escapeRegExp, escapeHtml } from './utils.js';
import { CONTRACT_SKILL_PROFILES, SPECIAL_SKILL_BADGE_RULES } from './profiles.js';

/**
 * Strips combat resolution clauses (damage numbers, crits, blocks, dodges, counters, and actor prefix)
 * and normalizes trailing dashes from an ultimate cut-in message so only clean flavor text remains.
 * @param {string} rawText - Raw log message segment.
 * @param {string} [actorName=''] - Display name of the casting actor.
 * @returns {string} Cleaned narrative flavor text.
 */
function stripCombatOutcomeText(rawText, actorName = '') {
    let text = String(rawText || '');
    if (actorName) {
        const escapedActorName = escapeRegExp(actorName);
        text = text.replace(new RegExp(`^${escapedActorName}[：:]?\\s*(的\\s*)?`), '');
    }

    text = text
        .replace(/[，,、]?\s*會心一擊[！!]?/g, '')
        .replace(/[，,、]?\s*但是被\s*.+?\s*用.+?抵擋[，,]?\s*造成了?\s*\d+\s*點(?:真實)?傷害[！!]?/g, '')
        .replace(/[，,、]?\s*但是被\s*.+?\s*躲開了[！!]?/g, '')
        .replace(/[，,、]?\s*但是遭\s*.+?\s*反擊[，,]?\s*(?:會心一擊[！!]?\s*)?受到\s*\d+\s*點傷害[！!]?/g, '')
        .replace(/[，,、]?\s*(?:對\s*.+?\s*)?造成了?\s*\d+\s*點(?:真實)?傷害[！!。.]?/g, '')
        .replace(/[—─ー―-]+$/g, '')
        .replace(/^[，,、：:\s]+/, '')
        .replace(/[，,、\s]+$/, '')
        .trim();

    if (text.length > 0 && !/[。！!?.」…]$/.test(text)) {
        text += '……';
    }
    return text;
}

/**
 * Plays a slow-motion letterbox K.O. slash sequence on a defeated actor.
 * @param {ShadowRoot} sr - Stage ShadowRoot instance.
 * @param {string} actorId - ID of the defeated actor.
 * @param {number} [token=engineState.playbackToken] - Active playback token for cancellation checks.
 * @returns {Promise<void>}
 */
export async function playFatalitySequence(sr, actorId, token = engineState.playbackToken) {
    const overlay = sr.getElementById('fatality-overlay');
    const actorEl = sr.getElementById(`actor-${actorId}`);
    if (!overlay || !actorEl || engineState.playbackToken !== token) return;

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

        if (engineState.playbackToken === token) {
            overlay.classList.remove('active');
        }

        setTimeout(() => {
            if (slash.isConnected) slash.remove();
            if (deathText.isConnected) deathText.remove();
        }, 1000);
    } finally {
        if (engineState.playbackToken === token) {
            engineState.timeScale = 1.0;
        }
    }
}

/**
 * Renders a full-screen vertical-text Ultimate skill cut-in animation.
 * Extracts either a spoken quote (preceded by a colon) or the skill name along with cleaned flavor text.
 * @param {object} frame - Current combat frame.
 * @param {ShadowRoot} sr - Stage ShadowRoot instance.
 * @param {number} token - Active playback token for cancellation checks.
 * @returns {Promise<void>}
 */
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

    // Only match actual spoken dialogue quotes preceded by a colon (e.g., 低喝：「...」 or 角色：「...」),
    // preventing inline object quotes like 把「火」拋向半空 from being hollowed out.
    const spokenQuoteMatch = frame.message.match(/[：:]\s*「([^」]+)」/);

    if (spokenQuoteMatch && spokenQuoteMatch[1].length <= 15) {
        mainText = spokenQuoteMatch[1];
        const rawRemainingText = frame.message
            .replace(actor.name, '')
            .replace(/[：:]\s*「[^」]+」\s*/, ' ')
            .trim();
        subText = stripCombatOutcomeText(rawRemainingText, actor.name);
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

        subText = stripCombatOutcomeText(frame.message, actor.name);
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

/**
 * Spawns a typewriter-animated speech bubble next to a speaking actor.
 * @param {object} frame - Current dialogue frame.
 * @param {ShadowRoot} sr - Stage ShadowRoot instance.
 * @param {number} token - Active playback token.
 * @returns {number} Additional reading duration in milliseconds.
 */
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

/**
 * Spawns an overhead pill badge for dice checks (threshold, opposed, roll) or status ailments.
 * @param {object} frame - Current combat frame.
 * @param {ShadowRoot} sr - Stage ShadowRoot instance.
 */
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

    if (frame.contractEvent === 'END') {
        const profile = CONTRACT_SKILL_PROFILES[frame.skillId];
        const actorOnlyEl = sr.getElementById(`actor-${frame.actorId}`);
        if (actorOnlyEl && profile) {
            const badge = document.createElement('div');
            badge.className = 'dice-badge dice-warn';
            badge.textContent = profile.endBadgeText || '契約結束';
            actorOnlyEl.appendChild(badge);
            setTimeout(() => {
                if (badge.isConnected) badge.remove();
            }, 1200 / getEffectiveSpeed());
        }
        return;
    }

    for (const rule of SPECIAL_SKILL_BADGE_RULES) {
        if (frame.skillId === rule.skillId && frame.message) {
            const match = frame.message.match(rule.regex);
            if (match) {
                const badgeTargetId = rule.target === 'actor' ? frame.actorId : (frame.targetId || frame.actorId);
                const badgeTargetEl = sr.getElementById(`actor-${badgeTargetId}`);
                if (!badgeTargetEl) return;

                const badge = document.createElement('div');
                badge.className = `dice-badge ${rule.styleClass}`;
                badge.textContent = rule.text(match);
                badgeTargetEl.appendChild(badge);

                if (rule.shakeTarget) {
                    badgeTargetEl.animate([
                        { transform: 'translateX(0)' },
                        { transform: 'translateX(-6px) rotate(-2deg)', offset: 0.25 },
                        { transform: 'translateX(6px) rotate(2deg)', offset: 0.5 },
                        { transform: 'translateX(-4px)', offset: 0.75 },
                        { transform: 'translateX(0)' }
                    ], { duration: 360 / getEffectiveSpeed() });
                }

                setTimeout(() => {
                    if (badge.isConnected) badge.remove();
                }, 1300 / getEffectiveSpeed());
                return;
            }
        }
    }
}

/**
 * Renders a dual-actor (or solo-fallback) SAO-styled System Contract Cut-In overlay.
 * Automatically shortens duration on repeat casts within the same battle to preserve pacing.
 * @param {object} frame - Current combat frame.
 * @param {ShadowRoot} sr - Stage ShadowRoot instance.
 * @param {number} token - Active playback token.
 * @returns {Promise<void>}
 */
export async function playContractCutIn(frame, sr, token) {
    const actor = engineState.actors.get(frame.actorId);
    const partner = frame.targetId ? engineState.actors.get(frame.targetId) : null;
    const profile = CONTRACT_SKILL_PROFILES[frame.skillId];
    if (!actor || !profile || engineState.playbackToken !== token) return;

    const arena = sr.getElementById('arena');
    if (!arena) return;

    const isDual = !!partner && partner.id !== actor.id;
    const baseDuration = frame.isContractRepeat ? 1050 : 1750;
    const actualDuration = baseDuration / getEffectiveSpeed();

    const overlay = document.createElement('div');
    overlay.className = `contract-cutin-overlay ${isDual ? 'dual-mode' : 'solo-mode'}`;
    overlay.style.setProperty('--contract-theme', profile.themeColor || '#f687b3');
    overlay.style.animationDuration = `${actualDuration}ms`;

    const safeActorName = escapeHtml(actor.name);
    const safeActorAvatar = escapeHtml(actor.avatar);
    const safePartnerName = partner ? escapeHtml(partner.name) : '';
    const safePartnerAvatar = partner ? escapeHtml(partner.avatar) : '';
    const safeBadgeIcon = escapeHtml(profile.badgeIcon);
    const safeBadgeText = escapeHtml(profile.badgeText);
    const safeSystemTitle = escapeHtml(profile.systemTitle);
    const safeSystemSubtitle = escapeHtml(profile.systemSubtitle);

    const portraitsHtml = isDual
        ? `
            <div class="contract-portrait left-partner">
                <img src="${safeActorAvatar}" onerror="this.src='${DEFAULT_AVATAR_URL}'">
                <div class="contract-partner-name">${safeActorName}</div>
            </div>
            <div class="contract-portrait right-partner">
                <img src="${safePartnerAvatar}" onerror="this.src='${DEFAULT_AVATAR_URL}'">
                <div class="contract-partner-name">${safePartnerName}</div>
            </div>
        `
        : `
            <div class="contract-portrait solo-partner">
                <img src="${safeActorAvatar}" onerror="this.src='${DEFAULT_AVATAR_URL}'">
                <div class="contract-partner-name">${safeActorName}</div>
            </div>
        `;

    const headlineText = isDual
        ? `${safeActorName} <span>${safeBadgeIcon}</span> ${safePartnerName}`
        : `${safeActorName} <span>${safeBadgeIcon}</span> ${safeBadgeText}`;

    overlay.innerHTML = `
        <div class="contract-backdrop"></div>
        <div class="contract-portraits-layer contract-Portraits-layer">${portraitsHtml}</div>
        <div class="sao-modal-card">
            <div class="sao-modal-header">${safeSystemTitle}</div>
            <div class="sao-modal-body">
                <div class="sao-modal-couple">${headlineText}</div>
                <div class="sao-modal-desc">${safeSystemSubtitle}</div>
            </div>
            <div class="sao-modal-footer">
                <div class="sao-btn sao-btn-accept">◯</div>
                <div class="sao-btn sao-btn-cancel">✕</div>
            </div>
        </div>
    `;

    arena.appendChild(overlay);

    const acceptBtn = overlay.querySelector('.sao-btn-accept');
    setTimeout(() => {
        if (acceptBtn && acceptBtn.isConnected) {
            acceptBtn.classList.add('pressed');
        }
    }, actualDuration * 0.38);

    return new Promise(resolve => {
        setTimeout(() => {
            if (overlay.isConnected) overlay.remove();
            resolve();
        }, actualDuration);
    });
}

/**
 * Spawns a glowing diagonal cross emblem on the target before the 11th piercing hit of Mother's Rosario.
 * @param {object} frame - Current combat frame.
 * @param {ShadowRoot} sr - Stage ShadowRoot instance.
 */
export function spawnRosarioCross(frame, sr) {
    const targetId = frame.targetId || frame.actorId;
    if (!targetId) return;
    const targetEl = sr.getElementById(`actor-${targetId}`);
    if (!targetEl) return;

    const existing = targetEl.querySelector('.rosario-cross-mark');
    if (existing) existing.remove();

    const crossEl = document.createElement('div');
    crossEl.className = 'rosario-cross-mark';
    crossEl.innerHTML = `
        <div class="rosario-line line-1"></div>
        <div class="rosario-line line-2"></div>
        <div class="rosario-core"></div>
    `;
    targetEl.appendChild(crossEl);

    setTimeout(() => {
        if (crossEl.isConnected) crossEl.remove();
    }, 1800 / getEffectiveSpeed());
}