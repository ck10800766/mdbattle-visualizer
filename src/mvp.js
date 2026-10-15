// src/mvp.js
import { engineState } from './state.js';
import { getConsolidatedStats } from './parser.js';

export function showMVPPanel() {
    const sr = engineState.shadowRoot;
    if (!sr || sr.getElementById('mdbv-mvp-panel')) return;

    const { consolidated, mvp, maxTotalDamage } = getConsolidatedStats();

    const theme = engineState.battleResult === 'WIN'
        ? { main: '#f6e05e', dark: '#1a202c', text: 'VICTORY', sub: '勝利', accent: '#d69e2e' }
        : { main: '#fc8181', dark: '#2d3748', text: 'DEFEAT', sub: '敗北', accent: '#c53030' };

    const overlay = document.createElement('div');
    overlay.id = 'mdbv-mvp-panel';
    overlay.style.cssText = `
        position: absolute; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(10, 15, 25, 0.95); z-index: 3000;
        overflow: hidden;
        font-family: Impact, "Arial Black", "Noto Sans TC", sans-serif;
        animation: panelFadeIn 0.5s ease-out forwards;
    `;

    const style = document.createElement('style');
    style.textContent = `
        @keyframes panelFadeIn { 0% { opacity: 0; } 100% { opacity: 1; } }
        @keyframes slideInLeft { 0% { transform: translateX(-50px) skewX(-10deg); opacity: 0; } 100% { transform: translateX(0) skewX(-10deg); opacity: 1; } }
        @keyframes slideInRight { 0% { transform: translateX(100px); opacity: 0; } 100% { transform: translateX(0); opacity: 1; } }
        @keyframes barGrow { 0% { width: 0; } 100% { width: var(--target-width); } }
        @keyframes bgScroll { 0% { background-position: 0 0; } 100% { background-position: -80px 80px; } }

        .jrpg-bg-stripes { position: absolute; top: -50%; left: -50%; width: 200%; height: 200%; background-image: repeating-linear-gradient(45deg, transparent, transparent 20px, rgba(255,255,255,0.02) 20px, rgba(255,255,255,0.02) 40px); animation: bgScroll 8s linear infinite; z-index: 1; pointer-events: none; }
        .mvp-splash { position: absolute; right: -5%; top: 0; height: 100%; width: 60%; background: ${theme.dark}; clip-path: polygon(15% 0, 100% 0, 100% 100%, 0% 100%); z-index: 2; border-left: none; animation: slideInRight 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards; display: flex; align-items: center; justify-content: center; overflow: hidden; pointer-events: none; }
        .mvp-avatar { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; object-position: center 20%; transform: scale(1.05); filter: drop-shadow(10px 10px 0px rgba(0,0,0,0.5)); z-index: 1; }
        .ui-container { position: absolute; left: 5%; top: 10%; height: 80%; width: 50%; z-index: 3; display: flex; flex-direction: column; justify-content: space-between; }
        .title-group { transform: skewX(-10deg); animation: slideInLeft 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .title-main { font-size: clamp(60px, 10vw, 120px); color: transparent; -webkit-text-stroke: 3px ${theme.main}; letter-spacing: 10px; margin: 0; line-height: 1; text-shadow: 6px 6px 0px ${theme.accent}; }
        .title-sub { font-size: 32px; background: ${theme.main}; display: inline-block; padding: 5px 20px; color: ${theme.dark}; font-weight: 900; letter-spacing: 8px; }
        .stats-container { display: flex; flex-direction: column; gap: 12px; transform: skewX(-10deg); }
        .stat-row { display: flex; align-items: center; background: rgba(0,0,0,0.6); padding: 10px 15px 10px 20px; border-left: 5px solid ${theme.main}; backdrop-filter: blur(4px); opacity: 0; animation: slideInLeft 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .stat-name { width: 130px; padding-left: 5px; font-size: 20px; color: #fff; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transform: skewX(10deg); }
        .stat-bar-wrapper { flex: 1; height: 24px; background: rgba(255,255,255,0.1); margin: 0 20px; position: relative; overflow: hidden; }
        .stat-bar-fill { height: 100%; background: ${theme.main}; box-shadow: inset 0 -5px 0 rgba(0,0,0,0.3); width: 0; animation: barGrow 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .stat-numbers { width: 140px; text-align: right; transform: skewX(10deg); }
        .stat-dmg { font-size: 24px; color: ${theme.main}; }
        .stat-taken { font-size: 14px; color: #a0aec0; }
        .close-btn { align-self: flex-start; margin-top: 30px; background: ${theme.main}; color: ${theme.dark}; border: none; padding: 15px 40px; font-size: 20px; font-weight: 900; cursor: pointer; transform: skewX(-10deg); box-shadow: 4px 4px 0 rgba(0,0,0,0.5); opacity: 0; transition: transform 0.1s, box-shadow 0.1s; animation: slideInLeft 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .close-btn:hover { transform: skewX(-10deg) translate(-2px, -2px); box-shadow: 6px 6px 0 rgba(0,0,0,0.5); }
        .close-btn:active { transform: skewX(-10deg) translate(2px, 2px); box-shadow: 2px 2px 0 rgba(0,0,0,0.5); }
        .mvp-label { position: absolute; left: 12%; top: 40px; background: ${theme.main}; color: ${theme.dark}; padding: 10px 30px; font-size: 28px; font-weight: 900; transform: skewX(-15deg); box-shadow: 5px 5px 0 rgba(0,0,0,0.5); z-index: 10; letter-spacing: 4px; }
    `;
    overlay.appendChild(style);

    const bgStripes = document.createElement('div');
    bgStripes.className = 'jrpg-bg-stripes';
    overlay.appendChild(bgStripes);

    if (mvp) {
        const mvpSplash = document.createElement('div');
        mvpSplash.className = 'mvp-splash';

        const mvpLabel = document.createElement('div');
        mvpLabel.className = 'mvp-label';
        mvpLabel.textContent = mvp.name;

        const mvpImg = document.createElement('img');
        mvpImg.className = 'mvp-avatar';
        mvpImg.src = mvp.avatar;
        mvpImg.onerror = () => { mvpImg.src = 'https://via.placeholder.com/600'; };

        mvpSplash.appendChild(mvpLabel);
        mvpSplash.appendChild(mvpImg);
        overlay.appendChild(mvpSplash);
    }

    const uiContainer = document.createElement('div');
    uiContainer.className = 'ui-container';

    const titleGroup = document.createElement('div');
    titleGroup.className = 'title-group';
    titleGroup.innerHTML = `
        <div class="title-sub">${theme.sub}</div>
        <h1 class="title-main">${theme.text}</h1>
    `;
    uiContainer.appendChild(titleGroup);

    const statsContainer = document.createElement('div');
    statsContainer.className = 'stats-container';

    const headerRow = document.createElement('div');
    headerRow.style.cssText = 'display: flex; color: #a0aec0; font-family: sans-serif; font-size: 12px; margin-bottom: 5px; transform: skewX(10deg); padding-left: 15px;';
    headerRow.innerHTML = `
        <div style="width: 120px;">MEMBER</div>
        <div style="flex: 1; margin: 0 20px;">CONTRIBUTION</div>
        <div style="width: 140px; text-align: right;">OUTPUT / TAKEN</div>
    `;
    statsContainer.appendChild(headerRow);

    const animateValue = (element, endValue, delay) => {
        let startTimestamp = null;
        const duration = 800;

        const step = (timestamp) => {
            if (!element.isConnected) return;
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            const easeOut = 1 - Math.pow(1 - progress, 3);

            element.textContent = Math.floor(easeOut * endValue).toLocaleString('en-US');
            if (progress < 1) {
                window.requestAnimationFrame(step);
            } else {
                element.textContent = Math.round(endValue).toLocaleString('en-US');
            }
        };

        setTimeout(() => {
            window.requestAnimationFrame(step);
        }, delay * 1000);
    };

    let delayCounter = 0.4;

    consolidated.forEach(stats => {
        if (stats.actor.isSummon) return;

        const { actor, totalOutput, totalTaken } = stats;
        const dmgPct = maxTotalDamage > 0 ? (totalOutput / maxTotalDamage) * 100 : 0;
        const formatNum = (num) => Math.round(num).toLocaleString('en-US');

        const row = document.createElement('div');
        row.className = 'stat-row';
        row.style.animationDelay = `${delayCounter}s`;

        row.innerHTML = `
            <div class="stat-name">${actor.name}</div>
            <div class="stat-bar-wrapper">
                <div class="stat-bar-fill" style="--target-width: ${dmgPct}%; animation-delay: ${delayCounter + 0.2}s;"></div>
            </div>
            <div class="stat-numbers">
                <div class="stat-dmg" id="dmg-${actor.id}">0</div>
                <div class="stat-taken">TAKEN: ${formatNum(totalTaken)}</div>
            </div>
        `;
        statsContainer.appendChild(row);

        setTimeout(() => {
            const dmgEl = row.querySelector(`#dmg-${actor.id}`);
            if (dmgEl) animateValue(dmgEl, totalOutput, delayCounter + 0.2);
        }, 0);

        delayCounter += 0.1;
    });

    const closeBtn = document.createElement('button');
    closeBtn.className = 'close-btn';
    closeBtn.textContent = 'NEXT // 結束演出';
    closeBtn.style.animationDelay = `${delayCounter + 0.2}s`;
    closeBtn.onclick = () => overlay.remove();

    uiContainer.appendChild(statsContainer);
    uiContainer.appendChild(closeBtn);
    overlay.appendChild(uiContainer);

    sr.appendChild(overlay);
}