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
import { escapeRegExp, escapeHtml, getMessageReadingDuration } from './utils.js';
import {
    getContractSkillProfile,
    matchesSkill,
    getCrossFinisherProfile,
    isPrimaryUltimateTriggerFrame,
    SPECIAL_SKILL_BADGE_RULES
} from './profiles.js';

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
        .replace(/^[第輪次]\s*\d+\s*[擊輪次劍枚][，,、\s]*/g, '')
        .replace(/[，,、]?\s*(?:會心一擊|精準劃過要害|正中要害)[！!]?/g, '')
        .replace(/[，,、]?\s*但是被\s*.+?\s*用.+?抵擋[，,]?\s*(?:造成了?|受到)\s*\d+\s*點(?:真實)?傷害[！!]?/g, '')
        .replace(/[，,、]?\s*但是被\s*.+?\s*躲開了[！!]?/g, '')
        .replace(/[，,、]?\s*但是遭\s*.+?\s*反擊[，,]?\s*(?:會心一擊[！!]?\s*)?(?:造成了?|受到)\s*\d+\s*點(?:真實)?傷害[！!]?/g, '')
        .replace(/[，,、]?\s*(?:(?:對|在)\s*.+?\s*|(?:[^\s，,。]+?\s*))?(?:命中並\s*)?(?:造成了?|受到)\s*\d+\s*點(?:真實)?傷害[！!。.]?/g, '')
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
 * Generic extraction of skill name from a combat log frame message.
 * Utilizes the structural invariant in MD templates:
 * Skill invocations follow `<verb>了 <SkillName>` or `進入 <SkillName>` with an ASCII space
 * following the verb/keyword, whereas standard narrative descriptions attach "了" directly
 * to actions without whitespace.
 *
 * Excludes numerical damage/healing resolutions and actions targeting other actors.
 *
 * @param {string} message - Frame message text.
 * @returns {string|null} Extracted skill name or null.
 */
export function extractSkillFromMessage(message) {
    if (!message) return null;
    const pattern = /(?:[^\s，,。！!：:]{1,4}了|進入)\s+([^，,。！!—\s\d][^，,。！!—\s]*)/g;
    let m;
    while ((m = pattern.exec(message)) !== null) {
        const token = m[1].replace(/^[「『\[【](.*?)[」』\]】]$/, '$1');
        // Exclude spatial direction/movement prepositions
        if (/^(?:半空|空中|地面|身前|陣前|身旁|長桌旁|電梯|暗處|四周|前方|後方|頭頂)$/.test(token)) {
            continue;
        }
        const isActor = engineState?.actors ? Array.from(engineState.actors.values()).some(a => a.name === token) : false;
        if (!isActor) {
            return token;
        }
    }
    return null;
}

/**
 * Evaluates whether an ultimate frame should defer its full-screen Cut-In presentation
 * to a subsequent frame in the same turn.
 *
 * For multi-line ultimates (e.g. character monologue, prologue actions, or dramatic build-up lines
 * before the climactic skill execution), playback allows character speech bubbles and actions to play
 * on stage first, triggering the Cut-In when the actual skill invocation or chant climax frame is reached.
 *
 * @param {object} frame - Current combat frame.
 * @returns {boolean} True if cut-in presentation should defer to a subsequent climax frame.
 */
export function shouldDeferUltimateCutIn(frame) {
    if (!engineState.frames || !frame || frame.index == null) return false;

    // If current frame has a spoken chant quote (<= 20 chars) or explicit skill cast, it IS the climax!
    const currentMsg = String(frame.message || '');
    const currentQuote = currentMsg.match(/[：:]\s*「([^」]+)」/);
    if (currentQuote && currentQuote[1].length <= 20) {
        return false;
    }
    if (extractSkillFromMessage(currentMsg)) {
        return false;
    }

    // Otherwise, check if a subsequent frame in the same turn for this actor contains the climax cast
    for (let i = frame.index + 1; i <= Math.min(engineState.frames.length - 1, frame.index + 6); i++) {
        const candidate = engineState.frames[i];
        if (
            candidate &&
            candidate.turnNumber === frame.turnNumber &&
            candidate.actorId === frame.actorId &&
            candidate.skillTier === 'ultimate'
        ) {
            const candMsg = String(candidate.message || '');
            const candQuote = candMsg.match(/[：:]\s*「([^」]+)」/);
            if (candQuote && candQuote[1].length <= 20) {
                return true;
            }
            if (extractSkillFromMessage(candMsg)) {
                return true;
            }
            if (/把「([^」]+)」拋向/.test(candMsg)) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Evaluates whether a combat frame's dialogue quote is presented as the primary
 * focus of a full-screen Ultimate Cut-In.
 * When true, on-field speech bubbles for this frame should be suppressed to prevent
 * the character from delivering the same line twice (once in Cut-In, once in speech bubble).
 *
 * @param {object} frame - Combat frame to evaluate.
 * @returns {boolean} True if the dialogue quote is featured as the Cut-In title.
 */
export function isUltimateCutInQuoteFrame(frame) {
    if (!frame || frame.skillTier !== 'ultimate' || !isPrimaryUltimateTriggerFrame(frame)) return false;
    if (shouldDeferUltimateCutIn(frame)) return false;
    const msg = String(frame.message || '');
    const spokenQuoteMatch = msg.match(/[：:]\s*「([^」]+)」/);
    return Boolean(spokenQuoteMatch && spokenQuoteMatch[1].length <= 20);
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

    // Dismiss any existing speech bubbles on stage so they don't peek through the cut-in
    sr.querySelectorAll('.speech-bubble').forEach(b => b.remove());

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

    if (spokenQuoteMatch && spokenQuoteMatch[1].length <= 20) {
        mainText = spokenQuoteMatch[1];
        const rawRemainingText = frame.message
            .replace(actor.name, '')
            .replace(/[：:]\s*「[^」]+」\s*/, ' ')
            .trim();
        subText = stripCombatOutcomeText(rawRemainingText, actor.name);
    } else {
        let extractedSkillName = null;
        let skillSourceFrame = frame;

        // 1. Direct match on current frame
        extractedSkillName = extractSkillFromMessage(frame.message);
        if (!extractedSkillName) {
            // 2. Scan nearby frames within the same turn for the primary cast frame of this skill
            for (let i = Math.max(0, frame.index - 6); i <= Math.min(engineState.frames.length - 1, frame.index + 6); i++) {
                const candidate = engineState.frames[i];
                if (
                    candidate &&
                    candidate.turnNumber === frame.turnNumber &&
                    candidate.actorId === frame.actorId
                ) {
                    const candidateSkill = extractSkillFromMessage(candidate.message);
                    if (candidateSkill) {
                        extractedSkillName = candidateSkill;
                        skillSourceFrame = candidate;
                        break;
                    }
                }
            }
        }

        // 3. Fallback: bracketed card invocation in message, e.g. 把「火」拋向半空 -> 火之牌
        if (!extractedSkillName) {
            for (let i = Math.max(0, frame.index - 6); i <= Math.min(engineState.frames.length - 1, frame.index + 6); i++) {
                const candidate = engineState.frames[i];
                if (candidate && candidate.turnNumber === frame.turnNumber && candidate.actorId === frame.actorId) {
                    const cardMatch = String(candidate.message || '').match(/把「([^」]+)」拋向/);
                    if (cardMatch) {
                        extractedSkillName = `${cardMatch[1]}之牌`;
                        skillSourceFrame = candidate;
                        break;
                    }
                }
            }
        }

        // 4. Fallback: frame.skillName if available from parser
        if (!extractedSkillName && frame.skillName) {
            extractedSkillName = frame.skillName;
        }

        if (extractedSkillName) {
            mainText = extractedSkillName;
            // Prefer narrative casting description over pure damage/block resolution lines
            let narrativeMsg = frame.message;
            if (!narrativeMsg || /造成了|受到|點傷害|會心一擊|防禦|閃避/.test(narrativeMsg)) {
                narrativeMsg = skillSourceFrame?.message || '';
            }
            const rawRemaining = narrativeMsg
                .replace(new RegExp(`(?:[^\\s，,。！!：:]{1,4}了|進入)\\s*${escapeRegExp(extractedSkillName)}[，,、\\s]*`), ' ')
                .trim();
            subText = stripCombatOutcomeText(rawRemaining, actor.name);
        } else {
            let rawSkillId = frame.skillId || 'ULTIMATE_SKILL';
            if (rawSkillId.includes('_')) {
                rawSkillId = rawSkillId.substring(rawSkillId.indexOf('_') + 1);
            }
            mainText = rawSkillId.replace(/_/g, ' ').toUpperCase();
            subText = stripCombatOutcomeText(frame.message, actor.name);
        }
    }

    const isEnglish = /[A-Za-z]/.test(mainText);

    const quoteEl = document.createElement('div');
    quoteEl.className = `ult-quote ${isEnglish ? 'lang-en' : 'lang-zh'}${mainText.length > 12 ? ' long-quote' : ''}`;
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
/**
 * Resolves the actual speaking actor from a frame's message and metadata.
 * Returns null if the voice is disembodied, an off-screen entity, or narrative text without quotes.
 *
 * @param {object} frame - Combat frame.
 * @returns {{ actorId: string, quote: string } | null} Resolved speaker actor ID and quote, or null.
 */
export function resolveDialogueSpeaker(frame) {
    if (!frame || !frame.message) return null;
    const msg = frame.message.trim();

    // 1. Switch dialogue pattern: 「Switch！」<actorName> 從...
    const switchMatch = msg.match(/^[「『"“]Switch[！!]?[」』"”]\s*([^\s，,。]+)/i);
    if (switchMatch) {
        const candidateName = switchMatch[1].trim();
        if (frame.targetId) {
            const targetActor = engineState.actors.get(frame.targetId);
            if (targetActor && (candidateName.startsWith(targetActor.name) || targetActor.name.startsWith(candidateName))) {
                return { actorId: targetActor.id, quote: 'Switch！' };
            }
        }
        for (const [id, actor] of engineState.actors.entries()) {
            if (candidateName.startsWith(actor.name) || actor.name.startsWith(candidateName)) {
                return { actorId: id, quote: 'Switch！' };
            }
        }
        return null;
    }

    // 2. Colon quote pattern: <SpeakerName>：[「『"“]<Quote>[」』"”]
    const colonQuoteMatch = msg.match(/^([^\n：:]{1,25})[：:]\s*[「『"“]([^」』"”]+)[」』"”]/);
    if (colonQuoteMatch) {
        const speakerPrefix = colonQuoteMatch[1].trim();
        const quote = `「${colonQuoteMatch[2].trim()}」`;

        if (frame.actorId) {
            const frameActor = engineState.actors.get(frame.actorId);
            if (frameActor && (speakerPrefix.startsWith(frameActor.name) || speakerPrefix.includes(frameActor.name))) {
                return { actorId: frameActor.id, quote };
            }
        }

        for (const [id, actor] of engineState.actors.entries()) {
            if (speakerPrefix.startsWith(actor.name) || speakerPrefix.includes(actor.name)) {
                return { actorId: id, quote };
            }
        }
        return null;
    }

    // 3. Standalone quote if message contains actor name followed by colon/quote or quote followed by actor
    const standaloneQuoteMatch = msg.match(/[「『"“]([^」』"”]+)[」』"”]/);
    if (standaloneQuoteMatch && (frame.type === 'BOSS_DIALOGUE' || frame.type === 'DIALOGUE')) {
        if (frame.actorId) {
            const frameActor = engineState.actors.get(frame.actorId);
            if (frameActor && msg.includes(frameActor.name) && !msg.startsWith('「Switch')) {
                return { actorId: frameActor.id, quote: `「${standaloneQuoteMatch[1].trim()}」` };
            }
        }
    }

    return null;
}

/**
 * Spawns a typewriter-animated speech bubble next to a speaking actor on the battlefield.
 * If the speaker is off-field or disembodied, does nothing on stage (the dialogue is
 * displayed cleanly in the bottom combat log box or scene narration subtitle banner).
 * @param {object} frame - Current dialogue frame.
 * @param {ShadowRoot} sr - Stage ShadowRoot instance.
 * @param {number} token - Active playback token.
 * @returns {number} Additional reading duration in milliseconds.
 */
export function renderSpeechBubble(frame, sr, token) {
    const speaker = resolveDialogueSpeaker(frame);
    if (!speaker) return 0;

    const actorEl = sr.getElementById(`actor-${speaker.actorId}`);
    const actor = engineState.actors.get(speaker.actorId);
    if (!actorEl || !actor) return 0;

    const existingBubble = actorEl.querySelector('.speech-bubble');
    if (existingBubble) existingBubble.remove();

    const bubble = document.createElement('div');
    bubble.className = `speech-bubble ${actor.side === 'left' ? 'left-bubble' : 'right-bubble'}`;

    const textSpan = document.createElement('span');
    textSpan.className = 'typewriter-text';
    bubble.appendChild(textSpan);
    actorEl.appendChild(bubble);

    // Dynamic vertical boundary clamping to prevent bubble from clipping into CTB timeline bar
    const arena = sr.getElementById('arena');
    if (arena) {
        const arenaRect = arena.getBoundingClientRect();
        const bubbleRect = bubble.getBoundingClientRect();
        const topOverflow = (arenaRect.top + 10) - bubbleRect.top;
        if (topOverflow > 0) {
            bubble.style.top = `${-25 + topOverflow}px`;
            bubble.classList.add('top-adjusted');
        }
    }

    const textContent = speaker.quote;
    const readTime = getMessageReadingDuration(textContent);

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
 * Renders an atmospheric scene narration subtitle at the bottom center of the arena.
 * Used for battle prologues, boss phase transitions, off-screen disembodied quotes,
 * and descriptive environmental storytelling.
 * @param {object} frame - Current narrative frame.
 * @param {ShadowRoot} sr - Stage ShadowRoot instance.
 * @param {number} token - Active playback token.
 * @returns {number} Additional reading duration in milliseconds.
 */
export function renderSceneNarrationBanner(frame, sr, token) {
    const arena = sr.getElementById('arena');
    if (!arena || !frame.message) return 0;

    const existingBanner = arena.querySelector('.scene-narration-banner');
    if (existingBanner) existingBanner.remove();

    const banner = document.createElement('div');
    banner.className = 'scene-narration-banner';
    banner.innerHTML = escapeHtml(frame.message).replace(/\n/g, '<br>');
    arena.appendChild(banner);

    const speed = getEffectiveSpeed();
    const displayDuration = getMessageReadingDuration(frame.message);

    setTimeout(() => {
        if (banner.isConnected && engineState.playbackToken === token) {
            banner.classList.add('fade-out');
            setTimeout(() => {
                if (banner.isConnected) banner.remove();
            }, 400 / speed);
        }
    }, displayDuration / speed);

    return displayDuration;
}

/**
 * Checks whether a frame is a scene narration or disembodied narrative frame.
 * @param {object} frame - Combat frame.
 * @returns {boolean} True if frame should be displayed in the scene narration subtitle banner.
 */
export function isSceneNarrationFrame(frame) {
    if (!frame || !frame.message) return false;
    if (frame.diceCheck || frame.isEnvironmentalPulse) return false;
    if (['DAMAGE', 'BLOCK', 'MISS', 'HEAL', 'LUCK_EVENT', 'COUNTER'].includes(frame.type)) return false;
    if (frame.value != null && frame.value > 0) return false;

    // If an on-field combatant is speaking, it's a character speech bubble, not scene narration
    if (resolveDialogueSpeaker(frame)) return false;

    // BOSS_DIALOGUE, DIALOGUE, or story narrative TEXT frames without an on-field speaker are scene narration
    if (['BOSS_DIALOGUE', 'DIALOGUE', 'TEXT'].includes(frame.type)) {
        return true;
    }

    // SKILL_TEXT with off-field dialogue or narrative quotes
    if (frame.type === 'SKILL_TEXT') {
        if (/^[^\n：:]{1,25}[：:]\s*[「『"“]|^[「『"“]/.test(frame.message.trim())) {
            return true;
        }
    }

    return false;
}

/**
 * Spawns an environmental dark red pulse shockwave sweeping across the entire battlefield.
 * Triggered on environmental hazard events such as Originium Altar pulses.
 * @param {object} frame - Current environmental frame.
 * @param {ShadowRoot} sr - Stage ShadowRoot instance.
 */
export function playEnvironmentalFieldPulse(frame, sr) {
    const arena = sr.getElementById('arena');
    if (!arena) return;

    const existingWave = arena.querySelector('.arena-field-wave');
    if (existingWave) existingWave.remove();

    const wave = document.createElement('div');
    wave.className = 'arena-field-wave';
    arena.appendChild(wave);

    const speed = getEffectiveSpeed();

    // Trigger subtle screen rumble and atmospheric combatant reaction
    engineState.actors.forEach(actor => {
        const el = sr.getElementById(`actor-${actor.id}`);
        if (el && el.animate) {
            el.animate([
                { filter: 'brightness(1)' },
                { filter: 'brightness(1.4) drop-shadow(0 0 10px rgba(229, 62, 62, 0.75))', offset: 0.3 },
                { filter: 'brightness(1)', offset: 1 }
            ], { duration: 550 / speed, easing: 'ease-out' });
        }
    });

    setTimeout(() => {
        if (wave.isConnected) wave.remove();
    }, 950 / speed);
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
        const profile = getContractSkillProfile(frame.skillId);
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
        if (matchesSkill(rule, frame.skillId) && frame.message) {
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
    const profile = getContractSkillProfile(frame.skillId);
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
    const profile = getCrossFinisherProfile(frame.skillId);
    if (profile?.crossColor) crossEl.style.setProperty('--cross-color', profile.crossColor);
    if (profile?.glowColor) crossEl.style.setProperty('--glow-color', profile.glowColor);
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