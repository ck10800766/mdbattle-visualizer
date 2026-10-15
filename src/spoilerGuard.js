// src/spoilerGuard.js

const DEATH_BANNER_TEXT = '你的角色死亡了，請進行轉生';
const PARTY_STATUS_REGEX = /^.+ · Lv\.\d+ · (死亡|存活)$/;

let isGuardArmed = false;
let guardTimeoutId = null;
let observerStarted = false;
let scanScheduled = false;

function ensureSpoilerStyle() {
    if (document.getElementById('mdbv-spoiler-style')) return;
    const style = document.createElement('style');
    style.id = 'mdbv-spoiler-style';
    style.textContent = `
        [data-mdbv-hide] { visibility: hidden !important; }
        [data-mdbv-gone] { display: none !important; }
        [data-mdbv-dialog-pending] { opacity: 0 !important; pointer-events: none !important; }
    `;
    (document.head || document.documentElement).appendChild(style);
}

/**
 * Scans the DOM and hides death banners, party survival statuses, and modal outcome badges.
 */
export function applySpoilerMask() {
    if (!isGuardArmed) return;
    ensureSpoilerStyle();

    // 1. Hide top death banner ("你的角色死亡了，請進行轉生")
    document.querySelectorAll('div').forEach(div => {
        if (div.childElementCount === 0 && div.textContent.trim() === DEATH_BANNER_TEXT) {
            div.setAttribute('data-mdbv-gone', '');
        }
    });

    // 2. Hide party member survival/death status ("… · Lv.58 · 存活／死亡")
    document.querySelectorAll('p').forEach(p => {
        if (p.childElementCount === 0 && PARTY_STATUS_REGEX.test(p.textContent.trim())) {
            p.setAttribute('data-mdbv-hide', '');
        }
    });

    // 3. Hide outcome badges ("勝利／失敗／平手", "死亡") in battle report dialogs,
    // and temporarily make the native dialog invisible while the visualizer is loading/playing
    document.querySelectorAll('[role="dialog"]').forEach(dlg => {
        const titleEl = Array.from(dlg.querySelectorAll('h2, h3, p, div')).find(
            el => el.childElementCount === 0 && el.textContent.trim() === '戰報'
        );
        if (titleEl) {
            let sibling = titleEl.nextElementSibling;
            while (sibling) {
                sibling.setAttribute('data-mdbv-hide', '');
                sibling = sibling.nextElementSibling;
            }
            dlg.setAttribute('data-mdbv-dialog-pending', '');
        }
    });
}

/**
 * Arms the anti-spoiler guard immediately when a battle POST request is sent or playback starts.
 */
export function armSpoilerGuard(timeoutMs = 45000) {
    isGuardArmed = true;
    applySpoilerMask();

    clearTimeout(guardTimeoutId);
    if (timeoutMs > 0) {
        guardTimeoutId = setTimeout(() => {
            // Safety fallback in case the network request fails and visualizer never opens
            if (!document.getElementById('mdbv-host')) {
                releaseSpoilerGuard();
            }
        }, timeoutMs);
    }
}

/**
 * Reveals all hidden outcomes once the visualizer reaches the end or is closed by the user.
 */
export function releaseSpoilerGuard() {
    isGuardArmed = false;
    clearTimeout(guardTimeoutId);

    document.querySelectorAll('[data-mdbv-hide]').forEach(el => el.removeAttribute('data-mdbv-hide'));
    document.querySelectorAll('[data-mdbv-gone]').forEach(el => el.removeAttribute('data-mdbv-gone'));
    document.querySelectorAll('[data-mdbv-dialog-pending]').forEach(el => el.removeAttribute('data-mdbv-dialog-pending'));
}

function scheduleMaskScan() {
    if (!isGuardArmed || scanScheduled) return;
    scanScheduled = true;
    queueMicrotask(() => {
        scanScheduled = false;
        try {
            if (isGuardArmed) applySpoilerMask();
        } catch (e) {
            // Ignore transient DOM mutation errors
        }
    });
}

export function initSpoilerObserver() {
    if (observerStarted) return;
    observerStarted = true;

    const observer = new MutationObserver(scheduleMaskScan);
    const startObserving = () => {
        if (document.documentElement) {
            observer.observe(document.documentElement, { childList: true, subtree: true });
        }
    };

    if (document.documentElement) {
        startObserving();
    } else {
        document.addEventListener('DOMContentLoaded', startObserving, { once: true });
    }
}