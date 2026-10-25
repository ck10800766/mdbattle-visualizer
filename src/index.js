// ==========================================
// FILE: src/index.js
// ==========================================
/**
 * @fileoverview Userscript entry point.
 * Intercepts `window.fetch` for live battle challenges and battle report loads,
 * arms the anti-spoiler DOM observer, fetches supplementary participant metadata when needed,
 * and mounts the manual bottom-right launch button.
 */

import { API_BASE } from './constants.js';
import { engineState, createEmptyCombo, nextPlaybackToken } from './state.js';
import { parseParticipants, buildStateSnapshots } from './parser.js';
import { createBattleStage } from './stage.js';
import { armSpoilerGuard, releaseSpoilerGuard, initSpoilerObserver } from './spoilerGuard.js';
import { extractBattlePayload, promptImportBattleReport, exportCurrentBattleReport } from './reportIO.js';

const originalFetch = window.fetch.bind(window);
let lastAutoLaunchedReportId = null;

/**
 * Recursively searches a JSON response object (up to depth 3) for a valid battle report payload containing logs[].
 * @param {object} obj - Candidate response object.
 * @param {number} [depth=0] - Current recursion depth.
 * @returns {object|null} Extracted battle payload or null if not found.
 */
function findBattlePayload(obj, depth = 0) {
    return extractBattlePayload(obj, depth);
}

/**
 * Verifies whether the battle payload includes valid participant HP statistics required by the stage.
 * @param {object} battleData - Battle report payload.
 * @returns {boolean} True if player participant stats are present.
 */
function hasValidParticipants(battleData) {
    const p = battleData?.participants;
    if (!p) return false;
    return Array.isArray(p.players) && p.players.length > 0 && p.players[0]?.stats?.hp != null;
}

/**
 * Ensures full report metadata (including participant maxHp and boss avatars) is present
 * before initializing the battle visualizer stage.
 * @param {object} rawBattleData - Intercepted battle response payload.
 * @param {{ force?: boolean }} [options={}] - Optional launch flags (`force` bypasses duplicate reportId suppression).
 * @returns {Promise<boolean>} True if a valid battle report was found and initialized.
 */
async function prepareAndInitVisualizer(rawBattleData, { force = false } = {}) {
    const battleData = findBattlePayload(rawBattleData);
    if (!battleData) return false;

    const reportId = battleData.reportId != null ? String(battleData.reportId) : null;

    // Prevent duplicate stage initialization if both POST challenge and GET battle-reports fire for the same reportId
    if (!force && reportId && reportId === lastAutoLaunchedReportId && engineState.hostElement) {
        return true;
    }
    if (reportId) {
        lastAutoLaunchedReportId = reportId;
    }

    let finalReportData = battleData;

    // Live challenge/duel POST responses may omit participant maxHp/avatars; fetch full report to merge
    if (!hasValidParticipants(battleData) && reportId) {
        try {
            const token = localStorage.getItem('token');
            const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
            const res = await originalFetch(`${API_BASE}/api/battle-reports/${reportId}?_t=${Date.now()}`, {
                headers,
                cache: 'no-store'
            });
            if (res.ok) {
                const fullData = await res.json();
                const fullBattle = findBattlePayload(fullData) || fullData;
                finalReportData = {
                    ...battleData,
                    ...fullBattle,
                    participants: fullBattle.participants || battleData.participants,
                    boss: fullBattle.boss || battleData.boss,
                    logs: fullBattle.logs || battleData.logs
                };
            }
        } catch (err) {
            console.warn('Visualizer: Failed to fetch supplementary participant data, using fallback.', err);
        }
    }

    initVisualizer(finalReportData);
    return true;
}

/**
 * Resets engine state, parses participants and frame snapshots, and mounts the battle stage.
 * @param {object} reportData - Complete battle report data.
 */
export function initVisualizer(reportData) {
    engineState.lastReportData = reportData;
    engineState.isPlaying = false;
    engineState.timeScale = 1.0;
    nextPlaybackToken();

    // Keep outcome spoilers masked on the underlying page while the visualizer is active
    armSpoilerGuard(0);

    engineState.currentFrameIndex = 0;
    engineState.currentCombo = createEmptyCombo();
    engineState.floatTracker.clear();
    engineState.totalTurns = 0;
    engineState.battleResult = reportData.result || 'WIN';

    parseParticipants(reportData);
    buildStateSnapshots(reportData.logs || []);

    engineState.actors.forEach(actor => {
        actor.currentHp = actor.maxHp;
    });

    createBattleStage();
}

// Register global callback so the stage UI can load imported/dropped JSON reports without circular imports
engineState.onImportReport = (payload) => {
    prepareAndInitVisualizer(payload, { force: true });
};

/**
 * Injects the floating launch button with seamless hover submenu (Import/Export) into the host page.
 * Keeps the original button appearance and normal cursor while supporting draggable repositioning
 * and allowing the mouse to glide seamlessly into the popup options.
 */
function createToggleButton() {
    if (!document.body || document.getElementById('mdbv-floating-dock')) return;

    if (!document.getElementById('mdbv-dock-styles')) {
        const style = document.createElement('style');
        style.id = 'mdbv-dock-styles';
        style.textContent = `
            #mdbv-floating-dock {
                position: fixed;
                z-index: 9999;
                display: flex;
                flex-direction: column-reverse;
                align-items: flex-end;
                gap: 6px;
                padding: 4px;
                user-select: none;
                touch-action: none;
            }
            #mdbv-toggle-btn {
                background: #2c7a7b;
                color: white;
                border: 1px solid #4fd1c5;
                padding: 10px 16px;
                border-radius: 8px;
                cursor: pointer;
                font-weight: bold;
                box-shadow: 0 4px 10px rgba(0, 0, 0, 0.4);
                font-size: 13px;
                white-space: nowrap;
                transition: background 0.15s, transform 0.1s;
            }
            #mdbv-toggle-btn:hover {
                background: #319795;
            }
            #mdbv-toggle-btn:active {
                transform: scale(0.98);
            }
            .mdbv-dock-menu {
                display: flex;
                flex-direction: column;
                gap: 6px;
                opacity: 0;
                pointer-events: none;
                transform: translateY(6px);
                transition: opacity 0.18s ease, transform 0.18s ease;
                position: relative;
            }
            /* Seamless hover bridge: ensures cursor never leaves dock when moving between button and menu */
            .mdbv-dock-menu::after {
                content: '';
                position: absolute;
                left: 0;
                right: 0;
                top: 100%;
                height: 10px;
                pointer-events: auto;
            }
            #mdbv-floating-dock:hover .mdbv-dock-menu,
            #mdbv-floating-dock.menu-open .mdbv-dock-menu {
                opacity: 1;
                pointer-events: auto;
                transform: translateY(0);
            }
            .mdbv-menu-item-btn {
                background: #2b6cb0;
                color: white;
                border: 1px solid #63b3ed;
                padding: 8px 14px;
                border-radius: 6px;
                cursor: pointer;
                font-weight: bold;
                box-shadow: 0 4px 8px rgba(0, 0, 0, 0.35);
                font-size: 13px;
                white-space: nowrap;
                transition: background 0.15s, transform 0.1s;
                text-align: left;
            }
            .mdbv-menu-item-btn:hover {
                background: #3182ce;
                transform: translateX(-2px);
            }
            .mdbv-menu-item-btn:active {
                transform: scale(0.98);
            }
        `;
        document.head.appendChild(style);
    }

    const dock = document.createElement('div');
    dock.id = 'mdbv-floating-dock';

    const menu = document.createElement('div');
    menu.className = 'mdbv-dock-menu';

    const importBtn = document.createElement('button');
    importBtn.id = 'mdbv-import-btn';
    importBtn.className = 'mdbv-menu-item-btn';
    importBtn.textContent = '載入戰報';
    importBtn.title = '從電腦載入已保存的 .json 戰報檔案進行離線重播';
    importBtn.onclick = (e) => {
        e.stopPropagation();
        dock.classList.remove('menu-open');
        promptImportBattleReport((payload) => {
            prepareAndInitVisualizer(payload, { force: true });
        });
    };

    const exportBtn = document.createElement('button');
    exportBtn.id = 'mdbv-export-btn';
    exportBtn.className = 'mdbv-menu-item-btn';
    exportBtn.textContent = '匯出戰報';
    exportBtn.title = '將當前戰報打包為 .json 檔案永久保存至本機';
    exportBtn.onclick = (e) => {
        e.stopPropagation();
        dock.classList.remove('menu-open');
        if (!engineState.lastReportData) {
            alert('目前尚無可匯出的戰報資料！請先進入戰報頁面或進行一場戰鬥。');
            return;
        }
        exportCurrentBattleReport();
    };

    menu.appendChild(importBtn);
    menu.appendChild(exportBtn);

    const mainBtn = document.createElement('button');
    mainBtn.id = 'mdbv-toggle-btn';
    mainBtn.textContent = '啟動視覺化演出';
    mainBtn.title = '點擊啟動視覺化戰況回放 (按住可拖曳調整位置)';

    mainBtn.onclick = async (e) => {
        if (didDrag) {
            e.stopPropagation();
            didDrag = false;
            return;
        }
        const match = location.pathname.match(/\/reports\/(\d+)/);
        if (match) {
            const reportId = match[1];
            mainBtn.textContent = '載入中...';
            try {
                const token = localStorage.getItem('token');
                const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

                const response = await originalFetch(`${API_BASE}/api/battle-reports/${reportId}?_t=${Date.now()}`, {
                    headers,
                    cache: 'no-store'
                });

                if (response.ok) {
                    const data = await response.json();
                    const launched = await prepareAndInitVisualizer(data, { force: true });
                    if (!launched) alert('無法解析戰報資料');
                } else {
                    alert(`讀取戰報失敗 (錯誤碼: ${response.status})`);
                }
            } catch (err) {
                console.error('Visualizer error:', err);
                alert('連線錯誤：已被瀏覽器或伺服器阻擋，請查看 F12 主控台');
            } finally {
                mainBtn.textContent = '啟動視覺化演出';
            }
        } else if (engineState.lastReportData) {
            initVisualizer(engineState.lastReportData);
        } else {
            alert('請先進行一場戰鬥、在戰報頁面使用，或點擊「載入戰報」讀取已保存的 JSON 戰報檔！');
        }
    };

    dock.appendChild(mainBtn);
    dock.appendChild(menu);
    document.body.appendChild(dock);

    const updateMenuOrientation = () => {
        const rect = dock.getBoundingClientRect();
        const isTopHalf = rect.top < 160;
        const isLeftHalf = rect.left < window.innerWidth / 2;

        dock.style.flexDirection = isTopHalf ? 'column' : 'column-reverse';
        dock.style.alignItems = isLeftHalf ? 'flex-start' : 'flex-end';
    };

    // Load persisted dock position or default to bottom-right
    const savedPos = (() => {
        try {
            const raw = localStorage.getItem('mdbv_dock_pos');
            if (raw) return JSON.parse(raw);
        } catch {}
        return null;
    })();

    if (savedPos && typeof savedPos.left === 'number' && typeof savedPos.top === 'number') {
        const maxLeft = Math.max(8, window.innerWidth - 180);
        const maxTop = Math.max(8, window.innerHeight - 60);
        dock.style.left = `${Math.max(8, Math.min(maxLeft, savedPos.left))}px`;
        dock.style.top = `${Math.max(8, Math.min(maxTop, savedPos.top))}px`;
        dock.style.right = 'auto';
        dock.style.bottom = 'auto';
    } else {
        dock.style.right = '20px';
        dock.style.bottom = '20px';
    }
    updateMenuOrientation();

    // Draggable interaction logic
    let isDragging = false;
    let didDrag = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    const onPointerMove = (e) => {
        const clientX = e.clientX ?? e.touches?.[0]?.clientX;
        const clientY = e.clientY ?? e.touches?.[0]?.clientY;
        if (clientX == null || clientY == null) return;

        const dx = clientX - startX;
        const dy = clientY - startY;

        if (!isDragging && Math.hypot(dx, dy) > 5) {
            isDragging = true;
            didDrag = true;
            dock.classList.remove('menu-open');
        }

        if (isDragging) {
            const maxLeft = Math.max(8, window.innerWidth - dock.offsetWidth - 8);
            const maxTop = Math.max(8, window.innerHeight - dock.offsetHeight - 8);
            const nextLeft = Math.max(8, Math.min(maxLeft, startLeft + dx));
            const nextTop = Math.max(8, Math.min(maxTop, startTop + dy));

            dock.style.left = `${nextLeft}px`;
            dock.style.top = `${nextTop}px`;
            dock.style.right = 'auto';
            dock.style.bottom = 'auto';
            updateMenuOrientation();
        }
    };

    const onPointerUp = () => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);

        if (isDragging) {
            isDragging = false;
            try {
                localStorage.setItem('mdbv_dock_pos', JSON.stringify({
                    left: parseInt(dock.style.left, 10),
                    top: parseInt(dock.style.top, 10)
                }));
            } catch {}
        }
    };

    mainBtn.addEventListener('pointerdown', (e) => {
        if (e.button != null && e.button !== 0) return;
        const clientX = e.clientX ?? e.touches?.[0]?.clientX;
        const clientY = e.clientY ?? e.touches?.[0]?.clientY;
        if (clientX == null || clientY == null) return;

        if (e.pointerType === 'touch') {
            dock.classList.add('menu-open');
        }

        isDragging = false;
        didDrag = false;
        startX = clientX;
        startY = clientY;

        const rect = dock.getBoundingClientRect();
        startLeft = rect.left;
        startTop = rect.top;

        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
    });

    document.addEventListener('pointerdown', (e) => {
        if (dock.classList.contains('menu-open') && !dock.contains(e.target)) {
            dock.classList.remove('menu-open');
        }
    });

    window.addEventListener('resize', () => {
        const rect = dock.getBoundingClientRect();
        const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
        const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
        const nextLeft = Math.max(8, Math.min(maxLeft, rect.left));
        const nextTop = Math.max(8, Math.min(maxTop, rect.top));
        dock.style.left = `${nextLeft}px`;
        dock.style.top = `${nextTop}px`;
        dock.style.right = 'auto';
        dock.style.bottom = 'auto';
        updateMenuOrientation();
    });
}

/**
 * Monkey-patches window.fetch to intercept live battle initiation requests and battle report loads.
 */
function installFetchInterceptor() {
    window.fetch = async function (...args) {
        const input = args[0];
        const init = args[1];
        const url = typeof input === 'string'
            ? input
            : (input?.url || (input instanceof URL ? input.href : ''));
        const method = String(init?.method || input?.method || 'GET').toUpperCase();

        // Detect live battle initiation (Dungeon Boss challenge or Player duel/action)
        const isLiveBattlePost =
            method === 'POST' &&
            (/\/api\/dungeon\/challenge(?:[?#]|$)/.test(url) ||
             /\/api\/players\/[^/]+\/[^/?#]+(?:[?#]|$)/.test(url));

        const isReportGet =
            method === 'GET' &&
            /\/api\/battle-reports\/\d+(?:[?#]|$)/.test(url);

        // Immediately arm spoiler guard before the POST request resolves
        if (isLiveBattlePost) {
            lastAutoLaunchedReportId = null;
            armSpoilerGuard(45000);
        }

        let response;
        try {
            response = await originalFetch(...args);
        } catch (err) {
            if (isLiveBattlePost) releaseSpoilerGuard();
            throw err;
        }

        try {
            if ((isLiveBattlePost || isReportGet) && response.ok) {
                const clonedResponse = response.clone();
                clonedResponse.json().then(data => {
                    const battlePayload = findBattlePayload(data);
                    if (battlePayload) {
                        prepareAndInitVisualizer(battlePayload);
                    } else if (isLiveBattlePost) {
                        releaseSpoilerGuard();
                    }
                }).catch(e => {
                    console.error('Visualizer: JSON parse error', e);
                    if (isLiveBattlePost) releaseSpoilerGuard();
                });
            } else if (isLiveBattlePost && !response.ok) {
                releaseSpoilerGuard();
            }
        } catch (e) {
            console.error('Visualizer: Fetch interception failed', e);
        }

        return response;
    };
}

initSpoilerObserver();
installFetchInterceptor();

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createToggleButton);
} else {
    createToggleButton();
}
