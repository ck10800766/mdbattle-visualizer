// src/index.js
import { engineState, createEmptyCombo, nextPlaybackToken } from './state.js';
import { parseParticipants, buildStateSnapshots } from './parser.js';
import { createBattleStage } from './stage.js';
import { armSpoilerGuard, releaseSpoilerGuard, initSpoilerObserver } from './spoilerGuard.js';

const API_BASE = 'https://mydoujin-backend.onrender.com';
const originalFetch = window.fetch.bind(window);
let lastAutoLaunchedReportId = null;

/**
 * Recursively searches a response object (up to depth 3) for a valid battle report payload containing logs[].
 */
function findBattlePayload(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 3) return null;
    if (Array.isArray(obj.logs) && obj.logs.some(l => l && typeof l === 'object')) {
        return obj;
    }
    for (const key of Object.keys(obj)) {
        const val = obj[key];
        if (val && typeof val === 'object' && !Array.isArray(val)) {
            const found = findBattlePayload(val, depth + 1);
            if (found) return found;
        }
    }
    return null;
}

/**
 * Checks whether the battle payload has valid participant HP stats required for the visualizer.
 */
function hasValidParticipants(battleData) {
    const p = battleData?.participants;
    if (!p) return false;
    const hasPlayers = Array.isArray(p.players) && p.players.length > 0 && p.players[0]?.stats?.hp != null;
    return hasPlayers;
}

/**
 * Ensures full report data (including participants and boss info) is present before launching the stage.
 */
async function prepareAndInitVisualizer(rawBattleData) {
    const battleData = findBattlePayload(rawBattleData);
    if (!battleData) return;

    const reportId = battleData.reportId != null ? String(battleData.reportId) : null;

    // Avoid launching twice if both POST challenge and GET battle-reports fire for the same reportId
    if (reportId && reportId === lastAutoLaunchedReportId && engineState.hostElement) {
        return;
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
}

export function initVisualizer(reportData) {
    engineState.lastReportData = reportData;
    engineState.isPlaying = false;
    engineState.timeScale = 1.0;
    nextPlaybackToken();

    // Keep outcome spoilers hidden on the underlying page while the visualizer is active
    armSpoilerGuard(0);

    engineState.currentFrameIndex = 0;
    engineState.currentCombo = createEmptyCombo();
    engineState.floatTracker.clear();
    engineState.totalTurns = 0;
    engineState.battleResult = reportData.result || 'WIN';

    parseParticipants(reportData);
    buildStateSnapshots(reportData.logs);

    engineState.actors.forEach(actor => {
        actor.currentHp = actor.maxHp;
    });

    createBattleStage();
}

function createToggleButton() {
    if (!document.body || document.getElementById('mdbv-toggle-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'mdbv-toggle-btn';
    btn.textContent = '啟動視覺化演出';
    btn.style.cssText = 'position: fixed; bottom: 20px; right: 20px; z-index: 9999; background: #2c7a7b; color: white; border: none; padding: 10px 15px; border-radius: 8px; cursor: pointer; font-weight: bold; box-shadow: 0 4px 6px rgba(0,0,0,0.3);';

    btn.onclick = async () => {
        const match = location.pathname.match(/\/reports\/(\d+)/);
        if (match) {
            const reportId = match[1];
            btn.textContent = '載入中...';
            try {
                const token = localStorage.getItem('token');
                const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

                const response = await originalFetch(`${API_BASE}/api/battle-reports/${reportId}?_t=${Date.now()}`, {
                    headers,
                    cache: 'no-store'
                });

                if (response.ok) {
                    const data = await response.json();
                    if (data && data.logs) initVisualizer(data);
                    else alert('無法解析戰報資料');
                } else {
                    alert(`讀取戰報失敗 (錯誤碼: ${response.status})`);
                }
            } catch (e) {
                console.error('Visualizer error:', e);
                alert('連線錯誤：已被瀏覽器或伺服器阻擋，請查看 F12 主控台');
            } finally {
                btn.textContent = '啟動視覺化演出';
            }
        } else if (engineState.lastReportData) {
            // Allow re-opening the most recent live battle on /boss or /players/:id
            initVisualizer(engineState.lastReportData);
        } else {
            alert('請先進行一場戰鬥或在戰報頁面使用此功能');
        }
    };

    document.body.appendChild(btn);
}

function installFetchInterceptor() {
    window.fetch = async function (...args) {
        const input = args[0];
        const init = args[1];
        const url = typeof input === 'string' ? input : (input?.url || '');
        const method = String(init?.method || input?.method || 'GET').toUpperCase();

        // Detect live battle initiation (Boss challenge or Player duel/chad)
        const isLiveBattlePost =
            method === 'POST' &&
            (/\/api\/dungeon\/challenge(?:[?#]|$)/.test(url) ||
             /\/api\/players\/[^/]+\/[^/?#]+(?:[?#]|$)/.test(url));

        const isReportGet =
            method === 'GET' &&
            /\/api\/battle-reports\/\d+(?:[?#]|$)/.test(url);

        // Immediately arm spoiler guard before the POST request even resolves
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