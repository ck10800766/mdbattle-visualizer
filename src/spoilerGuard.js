// ==========================================
// FILE: src/spoilerGuard.js
// ==========================================

const DEATH_BANNER_TEXT = '你的角色死亡了，請進行轉生';
const PARTY_STATUS_REGEX = /^.+ · Lv\.\d+ · (死亡|存活)$/;

let isGuardArmed = false;
let guardTimeoutId = null;
let observerStarted = false;
let scanScheduled = false;

/**
 * Injects the global CSS rules used to mask spoiler elements on the host document.
 */
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
 * Scans the host DOM and masks death banners, party survival statuses, and battle report outcome badges.
 */
export function applySpoilerMask() {
    if (!isGuardArmed) return;
    ensureSpoilerStyle();

    // 1. Hide top character death notification banner
    document.querySelectorAll('div').forEach(div => {
        if (div.childElementCount === 0 && div.textContent.trim() === DEATH_BANNER_TEXT) {
            div.setAttribute('data-mdbv-gone', '');
        }
    });

    // 2. Hide party member survival/death status lines
    document.querySelectorAll('p').forEach(p => {
        if (p.childElementCount === 0 && PARTY_STATUS_REGEX.test(p.textContent.trim())) {
            p.setAttribute('data-mdbv-hide', '');
        }
    });

    // 3. Hide outcome badges inside battle report dialogs and keep native dialog invisible during playback
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
 * Arms the anti-spoiler guard immediately when a live battle request is initiated or playback starts.
 * @param {number} [timeoutMs=45000] - Safety auto-release timeout in milliseconds (0 disables timeout).
 */
export function armSpoilerGuard(timeoutMs = 45000) {
    isGuardArmed = true;
    applySpoilerMask();

    clearTimeout(guardTimeoutId);
    if (timeoutMs > 0) {
        guardTimeoutId = setTimeout(() => {
            // Release automatically if the network request fails and the visualizer stage never mounts
            if (!document.getElementById('mdbv-host')) {
                releaseSpoilerGuard();
            }
        }, timeoutMs);
    }
}

/**
 * Unmasks all hidden host page outcomes once playback finishes or the user closes the visualizer.
 */
export function releaseSpoilerGuard() {
    isGuardArmed = false;
    clearTimeout(guardTimeoutId);

    document.querySelectorAll('[data-mdbv-hide]').forEach(el => el.removeAttribute('data-mdbv-hide'));
    document.querySelectorAll('[data-mdbv-gone]').forEach(el => el.removeAttribute('data-mdbv-gone'));
    document.querySelectorAll('[data-mdbv-dialog-pending]').forEach(el => el.removeAttribute('data-mdbv-dialog-pending'));
}

/**
 * Batches DOM mutation scans into a microtask to avoid layout thrashing during React renders.
 */
function scheduleMaskScan() {
    if (!isGuardArmed || scanScheduled) return;
    scanScheduled = true;
    queueMicrotask(() => {
        scanScheduled = false;
        try {
            if (isGuardArmed) applySpoilerMask();
        } catch (_err) {
            // Ignore transient DOM mutation errors
        }
    });
}

/**
 * Initializes the document-wide MutationObserver to catch dynamically rendered spoiler elements.
 */
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