// ==========================================
// FILE: src/cinematics.js
// ==========================================
import { engineState, getEffectiveSpeed } from './state.js';
import { escapeRegExp } from './utils.js';

/**
 * Plays a slow-motion letterbox K.O. slash sequence on a defeated actor.
 * @param {ShadowRoot} sr - Stage ShadowRoot instance.
 * @param {string} actorId - ID of the defeated actor.
 * @returns {Promise<void>}
 */
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

/**
 * Renders a full-screen vertical-text Ultimate skill cut-in animation.
 * Extracts either a short spoken quote or the skill name along with narrative flavor text.
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
}