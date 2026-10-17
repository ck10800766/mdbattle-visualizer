// ==========================================
// FILE: src/styles.js
// ==========================================
/**
 * @fileoverview Encapsulated Shadow DOM stylesheet (`STAGE_STYLES`) for the battle stage,
 * playback controls, ATB timeline bar, actor cards, combat VFX, and cinematic overlays.
 */

/**
 * Shadow DOM stylesheet for the battle stage, ATB bar, combat VFX, and overlays.
 * @type {string}
 */
export const STAGE_STYLES = `
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    .stage { width: 100%; height: 100%; display: flex; flex-direction: column; background: radial-gradient(circle at center, #1a202c 0%, #000 100%); }

    /* Playback Controls */
    .controls { display: flex; padding: 10px 20px; background: #171923; border-bottom: 1px solid #2d3748; gap: 15px; align-items: center; position: relative; z-index: 2500; }
    .seek-container { flex: 1; display: flex; align-items: center; gap: 10px; color: #a0aec0; font-size: 14px; font-variant-numeric: tabular-nums; }
    #seek-label { min-width: 68px; text-align: right; white-space: nowrap; }
    input[type="range"] { flex: 1; accent-color: #4fd1c5; cursor: pointer; }
    button { background: #2c7a7b; color: #fff; border: 1px solid #4fd1c5; padding: 6px 16px; border-radius: 4px; cursor: pointer; font-weight: bold; transition: background 0.2s, transform 0.1s; white-space: nowrap; font-size: 14px; }
    button:hover { background: #319795; }
    button:active { transform: scale(0.97); }
    button.btn-skip, button.danger { background: #9b2c2c; border-color: #fc8181; color: #fff; }
    button.btn-skip:hover, button.danger:hover { background: #c53030; }
    .version-tag { font-size: 11px; color: #718096; font-family: monospace; padding: 2px 6px; background: rgba(255, 255, 255, 0.05); border-radius: 4px; border: 1px solid rgba(255, 255, 255, 0.1); user-select: none; white-space: nowrap; }
    @media (max-width: 640px) {
        .controls { padding: 8px 10px; gap: 6px; }
        .seek-container { gap: 6px; font-size: 12px; }
        #seek-label { min-width: 52px; }
        button { padding: 5px 9px; font-size: 12px; }
        .version-tag { display: none; }
    }

    /* ATB / CTB Timeline Track */
    .ctb-container { height: 70px; background: rgba(0,0,0,0.8); border-bottom: 2px solid #4a5568; position: relative; z-index: 10; padding: 0 80px 0 40px; display: flex; align-items: center; box-shadow: 0 4px 10px rgba(0,0,0,0.5); }
    .ctb-track { position: relative; width: 100%; height: 4px; background: #4a5568; border-radius: 2px; }
    .ctb-action-point { position: absolute; right: -40px; top: -20px; width: 40px; height: 44px; border-left: 3px solid #f6e05e; display: flex; align-items: center; padding-left: 8px; color: #f6e05e; font-weight: bold; font-size: 12px; font-style: italic; box-shadow: -4px 0 8px -4px rgba(246,224,94,0.8); }
    .ctb-icon { position: absolute; top: -18px; width: 40px; height: 40px; border-radius: 50%; border: 2px solid #a0aec0; background: #1a202c; transform: translateX(-50%); transition: left 0.4s linear, opacity 0.2s ease; box-shadow: 0 2px 6px rgba(0,0,0,0.6); }
    .ctb-icon img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
    .ctb-icon.acting { border-color: #f6e05e; box-shadow: 0 0 15px #f6e05e; width: 50px; height: 50px; top: -23px; z-index: 999 !important; }
    .ctb-icon.left { border-color: #63b3ed; }
    .ctb-icon.right { border-color: #fc8181; }

    /* Battle Arena & Actor Cards */
    .arena { flex: 1; display: flex; justify-content: space-between; align-items: center; padding: 10px 5vw; position: relative; min-height: 0; overflow: hidden; }
    .team { display: flex; flex-direction: column; gap: 12px; align-items: center; align-content: center; max-width: 48%; max-height: 100%; }
    .left-team { justify-content: center; flex-wrap: wrap; }
    .right-team { justify-content: center; flex-wrap: wrap-reverse; }
    .actor { display: flex; flex-direction: column; align-items: center; transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275); position: relative; }
    .actor.unspawned { display: none !important; }
    .actor.spawning, .actor.despawning { transition: none !important; z-index: 50; }
    .actor.left.spawning { animation: summonSpawnLeft 0.55s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
    .actor.left.despawning { animation: summonDespawnLeft 0.45s cubic-bezier(0.16, 1, 0.3, 1) forwards; pointer-events: none; }
    .actor.right.spawning { animation: summonSpawnRight 0.55s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
    .actor.right.despawning { animation: summonDespawnRight 0.45s cubic-bezier(0.16, 1, 0.3, 1) forwards; pointer-events: none; }
    .actor.spawning { animation: summonSpawnLeft 0.55s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
    .actor.despawning { animation: summonDespawnLeft 0.45s cubic-bezier(0.16, 1, 0.3, 1) forwards; pointer-events: none; }
    .actor.dead { filter: grayscale(100%) brightness(45%) contrast(110%); opacity: 0.55; transition: filter 0.3s ease, opacity 0.3s ease; pointer-events: none; }
    .actor-name { color: #e2e8f0; font-size: 14px; font-weight: bold; margin-bottom: 8px; text-shadow: 0 2px 4px rgba(0,0,0,0.8); background: rgba(0,0,0,0.6); padding: 2px 8px; border-radius: 4px; border: 1px solid #4a5568; }
    .avatar-wrapper { position: relative; width: 80px; height: 80px; }
    .avatar { width: 80px; height: 80px; border-radius: 8px; border: 2px solid #4a5568; object-fit: cover; box-shadow: 0 8px 12px -3px rgba(0,0,0,0.6); transition: border-color 0.4s ease, box-shadow 0.4s ease; }

    .hp-container { width: 80px; height: 13px; background: #2d3748; border-radius: 6px; margin-top: 8px; overflow: hidden; position: relative; border: 1.5px solid #1a202c; transition: border-color 0.2s ease, box-shadow 0.2s ease; }
    .hp-container.shield-active { border-color: #63b3ed !important; box-shadow: 0 0 8px rgba(99, 179, 237, 0.75), inset 0 0 4px rgba(99, 179, 237, 0.45); }
    .hp-fill { height: 100%; background: #48bb78; transition: width 0.3s ease-out, background-color 0.3s; }
    .hp-fill.warning { background: #ecc94b; }
    .hp-fill.danger { background: #f56565; }
    .hp-text { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 10px; line-height: 1; color: #fff; font-weight: 800; text-shadow: 0 1px 2px #000; pointer-events: none; letter-spacing: -0.2px; }

    /* Actor Status Tray & Badges (Vertical column on avatar outer side) */
    .status-tray { position: absolute; top: 2px; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 4px; z-index: 25; pointer-events: auto; }
    .status-tray:empty { display: none; }
    .actor.left .status-tray { right: calc(100% + 6px); }
    .actor.right .status-tray { left: calc(100% + 6px); }
    .status-badge { width: 16px; height: 16px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 10px; line-height: 1; cursor: default; animation: slideInUp 0.15s ease-out forwards; border: 1px solid rgba(255, 255, 255, 0.2); background: rgba(15, 23, 42, 0.7); user-select: none; transition: transform 0.15s ease, box-shadow 0.15s ease; flex-shrink: 0; }
    .status-badge:hover { transform: scale(1.18); }
    .status-badge.status-dot { border-color: #9f7aea; background: rgba(85, 60, 154, 0.35); box-shadow: 0 0 6px rgba(159, 122, 234, 0.6); }
    .status-badge.status-hot { border-color: #48bb78; background: rgba(47, 133, 90, 0.35); box-shadow: 0 0 6px rgba(72, 187, 120, 0.6); }
    .status-badge.status-fatigue { border-color: #ed8936; background: rgba(192, 86, 33, 0.35); box-shadow: 0 0 6px rgba(237, 137, 54, 0.6); }
    .status-badge.status-silenced { border-color: #fc8181; background: rgba(197, 48, 48, 0.35); box-shadow: 0 0 6px rgba(252, 129, 129, 0.6); }
    .status-badge.status-bond { border-color: #f687b3; background: rgba(213, 63, 140, 0.35); box-shadow: 0 0 6px rgba(246, 135, 179, 0.6); }

    /* Dice Check & Status Badges */
    .dice-badge { position: absolute; top: -32px; left: 50%; transform: translateX(-50%); padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 800; color: #fff; white-space: nowrap; z-index: 55; pointer-events: none; box-shadow: 0 4px 10px rgba(0,0,0,0.6); animation: slideInUp 0.2s ease-out forwards; }
    .dice-pass { background: rgba(47, 133, 90, 0.95); border: 1px solid #68d391; }
    .dice-fail { background: rgba(197, 48, 48, 0.95); border: 1px solid #fc8181; }
    .dice-roll { background: rgba(43, 108, 176, 0.95); border: 1px solid #63b3ed; }
    .dice-warn { background: rgba(183, 121, 31, 0.95); border: 1px solid #f6e05e; }

    /* Combat Log Dialog Box */
    .dialog-box { height: 160px; background: linear-gradient(180deg, rgba(15, 23, 42, 0.9) 0%, rgba(0, 0, 0, 0.95) 100%); border-top: 2px solid #4fd1c5; padding: 10px 15px; color: #cbd5e1; font-family: "Segoe UI", Roboto, Helvetica, sans-serif; font-size: 14px; overflow-y: auto; scroll-behavior: smooth; box-shadow: inset 0 4px 6px rgba(0,0,0,0.5); }
    .log-line { margin-bottom: 4px; padding: 4px 8px; border-radius: 4px; animation: slideInUp 0.2s ease-out forwards; opacity: 0; line-height: 1.5; cursor: pointer; transition: background 0.15s ease, padding-left 0.15s ease, border-color 0.15s ease; user-select: text; border-left: 3px solid transparent; }
    .log-line:hover { background: rgba(255, 255, 255, 0.08); padding-left: 12px; }
    .log-line:hover .log-index { color: #81e6d9 !important; font-weight: 700; }
    .log-line.system-log { background: rgba(255, 255, 255, 0.03); border-left-color: transparent; }
    .log-line.system-log:hover { background: rgba(255, 255, 255, 0.08); border-left-color: #81e6d9; }
    .log-line.dialogue-log { background: rgba(79, 209, 197, 0.1); border-left: 3px solid #4fd1c5; color: #e2e8f0; font-weight: 500; }
    .log-line.dialogue-log:hover { background: rgba(79, 209, 197, 0.22); border-left-color: #81e6d9; }
    .log-line.narrative-log { background: rgba(255, 255, 255, 0.04); border-left: 3px solid #718096; color: #f1f5f9; font-style: italic; }
    .log-line.narrative-log:hover { background: rgba(255, 255, 255, 0.1); border-left-color: #cbd5e1; }
    .actor-name-left { font-weight: bold; color: #90cdf4; }
    .actor-name-right { font-weight: bold; color: #feb2b2; }

    /* Actor Speech Bubbles */
    .speech-bubble { position: absolute; top: -25px; background: rgba(15, 23, 42, 0.95); color: #f8fafc; padding: 12px 18px; border-radius: 12px; font-weight: normal; font-size: 15px; line-height: 1.5; max-width: 350px; width: max-content; word-wrap: break-word; box-shadow: 0 8px 16px rgba(0,0,0,0.6); z-index: 60; pointer-events: none; backdrop-filter: blur(4px); border: 1px solid; }
    .left-bubble { left: 85%; border-bottom-left-radius: 0; border-color: #63b3ed; }
    .left-bubble::after { content: ''; position: absolute; bottom: -10px; left: -1px; border-width: 10px 15px 0 0; border-style: solid; border-color: rgba(15, 23, 42, 0.95) transparent transparent transparent; }
    .right-bubble { right: 85%; border-bottom-right-radius: 0; border-color: #fc8181; }
    .right-bubble::after { content: ''; position: absolute; bottom: -10px; right: -1px; border-width: 10px 0 0 15px; border-style: solid; border-color: rgba(15, 23, 42, 0.95) transparent transparent transparent; }

    /* Floating Combat Text & Stamps */
    .floating-text { position: absolute; top: 30%; left: 50%; transform: translate(-50%, 0); font-size: 32px; font-weight: 900; color: #fff; text-shadow: 0 4px 6px rgba(0,0,0,1); animation: floatUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards; pointer-events: none; z-index: 20; white-space: nowrap; }
    .floating-crit { color: #fc8181; font-size: 46px; font-style: italic; filter: drop-shadow(0 0 8px #c53030); }
    .floating-block { color: #90cdf4; font-size: 26px; font-style: italic; text-shadow: 0 0 10px rgba(66, 153, 225, 0.9), 0 2px 4px #000; letter-spacing: 1px; }

    .combo-text { position: absolute; top: 10%; right: -60px; font-size: 40px; font-weight: 900; color: #f6ad55; font-style: italic; text-shadow: 0 4px 10px rgba(221, 107, 32, 0.8); animation: comboPop 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; pointer-events: none; z-index: 25; white-space: nowrap; }
    .break-stamp { position: absolute; top: 38%; left: 50%; transform: translate(-50%, -50%) rotate(-12deg) scale(1); font-size: 24px; font-weight: 900; color: #fc8181; border: 3px solid #e53e3e; padding: 2px 8px; border-radius: 6px; background: rgba(15, 23, 42, 0.88); text-shadow: 0 2px 6px rgba(0,0,0,0.9); box-shadow: 0 0 12px rgba(229, 62, 62, 0.6); opacity: 0; animation: stampDown 0.45s cubic-bezier(0.16, 1, 0.3, 1) forwards; pointer-events: none; z-index: 45; white-space: nowrap; }
    .luck-drop { position: absolute; top: -90px; left: 50%; transform: translateX(-50%); font-size: 44px; animation: dropDown 0.45s ease-in forwards; z-index: 40; pointer-events: none; }

    /* Ultimate Cut-In Overlay */
    .ultimate-overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: #000; z-index: 2000; display: flex; align-items: center; justify-content: center; opacity: 0; pointer-events: none; overflow: hidden; }
    .ultimate-overlay.active { animation: ult-bg-hold 2.5s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
    .ult-flash { position: absolute; width: 100%; height: 100%; background: #fff; z-index: 2010; animation: ult-flash-bang 2.5s ease-out forwards; }
    .ultimate-avatar-bg { position: absolute; width: 100%; height: 100%; object-fit: cover; object-position: center 25%; transform-origin: center 25%; opacity: 0.8; filter: grayscale(70%) contrast(160%) brightness(0.7); z-index: 2001; animation: ult-bg-zoom 2.5s ease-out forwards; }
    .ultimate-vignette { position: absolute; width: 100%; height: 100%; z-index: 2002; background: radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.8) 80%, #000 100%); }
    .ult-text-wrapper { position: absolute; z-index: 2005; height: 90%; top: 5%; writing-mode: vertical-rl; text-align: center; }
    .ult-text-wrapper.left-side { right: 8%; }
    .ult-text-wrapper.right-side { left: 8%; }
    .ult-quote { display: inline-block; margin-left: 2vw; font-family: "Yu Mincho", "Noto Serif TC", "PMingLiU", serif; font-weight: 900; color: #fff; text-shadow: 0 0 15px rgba(255,255,255,0.8), -3px 3px 0px #000, -8px 8px 0px rgba(180, 0, 0, 0.9); animation: ult-stamp 2.5s cubic-bezier(0.1, 1, 0.2, 1) forwards; }
    .ult-quote.lang-zh { font-size: clamp(30px, 7vh, 70px); text-orientation: mixed; letter-spacing: 1vh; }
    .ult-quote.lang-en { font-size: clamp(24px, 6vh, 60px); text-orientation: mixed; letter-spacing: 4px; }
    .ult-flavor { display: inline-block; font-family: "Yu Mincho", "Noto Serif TC", "PMingLiU", serif; font-size: clamp(14px, 2.5vh, 22px); color: #e2e8f0; text-shadow: -2px 2px 4px #000; text-orientation: mixed; letter-spacing: 0.5vh; animation: ult-stamp-delay 2.5s cubic-bezier(0.1, 1, 0.2, 1) forwards; }

    /* Low HP Danger Pulse */
    @keyframes panting-pulse { 0%, 100% { filter: drop-shadow(0 0 4px #e53e3e); transform: scale(1); } 50% { filter: drop-shadow(0 0 15px #c53030); transform: scale(1.03); } }
    .actor.danger-state .avatar { animation: panting-pulse 1.2s infinite ease-in-out; border: 2px solid #e53e3e; }

    /* Fatality Letterbox & Slash Effect */
    .fatality-overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.4); backdrop-filter: blur(2px); z-index: 1500; opacity: 0; pointer-events: none; transition: opacity 0.3s; }
    .fatality-overlay::before, .fatality-overlay::after { content: ''; position: absolute; left: 0; width: 100%; height: 12vh; background: #000; transition: transform 0.3s cubic-bezier(0.1, 1, 0.2, 1); }
    .fatality-overlay::before { top: 0; transform: translateY(-100%); }
    .fatality-overlay::after { bottom: 0; transform: translateY(100%); }
    .fatality-overlay.active { opacity: 1; }
    .fatality-overlay.active::before, .fatality-overlay.active::after { transform: translateY(0); }

    .fatality-slash { position: absolute; top: 50%; left: -20%; width: 140%; height: 3px; background: #fff; box-shadow: 0 0 10px #fff, 0 0 20px #fc8181; transform-origin: center; z-index: 1501; pointer-events: none; }
    @keyframes slash-strike { 0% { transform: rotate(-25deg) scaleX(0); opacity: 1; } 20% { transform: rotate(-25deg) scaleX(1); opacity: 1; } 100% { transform: rotate(-25deg) scaleX(1.2); opacity: 0; filter: blur(4px); } }

    .fatality-text { position: absolute; top: 50%; left: 50%; font-size: 64px; font-family: Impact, "Arial Black", sans-serif; font-style: italic; color: #fc8181; -webkit-text-stroke: 1px #fff; text-shadow: 4px 4px 0px rgba(0,0,0,0.8); z-index: 1502; opacity: 0; pointer-events: none; }
    @keyframes text-pop { 0% { transform: translate(-50%, -50%) skewX(-15deg) scale(2); opacity: 0; } 15% { transform: translate(-50%, -50%) skewX(-15deg) scale(1); opacity: 1; } 80% { transform: translate(-50%, -50%) skewX(-15deg) scale(1); opacity: 1; } 100% { transform: translate(-50%, -50%) skewX(-15deg) scale(0.9); opacity: 0; } }

    /* Keyframe Animations */
    @keyframes summonSpawnLeft {
        0% { opacity: 0; transform: translate3d(-180px, 0, 0) scale(0.6); filter: blur(6px) brightness(2.5) drop-shadow(0 0 18px #63b3ed); }
        60% { opacity: 1; filter: blur(1px) brightness(1.3) drop-shadow(0 0 10px #63b3ed); }
        100% { opacity: 1; transform: translate3d(0, 0, 0) scale(1); filter: blur(0) brightness(1) drop-shadow(0 0 0 transparent); }
    }
    @keyframes summonDespawnLeft {
        0% { opacity: 1; transform: translate3d(0, 0, 0) scale(1); filter: blur(0) brightness(1); }
        35% { filter: blur(2px) brightness(1.7) drop-shadow(0 0 14px #63b3ed); }
        100% { opacity: 0; transform: translate3d(-180px, 0, 0) scale(0.6); filter: blur(8px) brightness(2.2) drop-shadow(0 0 0 transparent); }
    }
    @keyframes summonSpawnRight {
        0% { opacity: 0; transform: translate3d(180px, 0, 0) scale(0.6); filter: blur(6px) brightness(2.5) drop-shadow(0 0 18px #fc8181); }
        60% { opacity: 1; filter: blur(1px) brightness(1.3) drop-shadow(0 0 10px #fc8181); }
        100% { opacity: 1; transform: translate3d(0, 0, 0) scale(1); filter: blur(0) brightness(1) drop-shadow(0 0 0 transparent); }
    }
    @keyframes summonDespawnRight {
        0% { opacity: 1; transform: translate3d(0, 0, 0) scale(1); filter: blur(0) brightness(1); }
        35% { filter: blur(2px) brightness(1.7) drop-shadow(0 0 14px #fc8181); }
        100% { opacity: 0; transform: translate3d(180px, 0, 0) scale(0.6); filter: blur(8px) brightness(2.2) drop-shadow(0 0 0 transparent); }
    }
    @keyframes summonSpawn { 0% { opacity: 0; transform: translate3d(-180px, 0, 0) scale(0.6); filter: blur(6px) brightness(2.5) drop-shadow(0 0 18px #63b3ed); } 100% { opacity: 1; transform: translate3d(0, 0, 0) scale(1); filter: blur(0) brightness(1); } }
    @keyframes summonDespawn { 0% { opacity: 1; transform: translate3d(0, 0, 0) scale(1); filter: blur(0) brightness(1); } 100% { opacity: 0; transform: translate3d(-180px, 0, 0) scale(0.6); filter: blur(8px) brightness(2.2); } }
    @keyframes ult-bg-hold { 0%, 100% { opacity: 0; } 5%, 95% { opacity: 1; } }
    @keyframes ult-flash-bang { 0% { opacity: 1; } 12% { opacity: 0; } 100% { opacity: 0; } }
    @keyframes ult-bg-zoom { 0% { transform: scale(1.15); filter: grayscale(0%) contrast(100%) brightness(0.9); } 10% { filter: grayscale(70%) contrast(160%) brightness(0.55); } 100% { transform: scale(1); filter: grayscale(70%) contrast(160%) brightness(0.55); } }
    @keyframes ult-stamp { 0% { transform: scale(3); opacity: 0; filter: blur(10px); } 10% { transform: scale(1); opacity: 1; filter: blur(0px); } 100% { transform: scale(1); opacity: 1; } }
    @keyframes ult-stamp-delay { 0%, 12% { transform: scale(2); opacity: 0; filter: blur(5px); } 18% { transform: scale(1); opacity: 1; filter: blur(0px); } 100% { transform: scale(1); opacity: 1; } }
    @keyframes slideInUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes floatUp { 0% { opacity: 1; transform: translate(-50%, 0) scale(0.8); } 20% { transform: translate(-50%, -10px) scale(1.2); } 100% { opacity: 0; transform: translate(-50%, -60px) scale(1); } }
    @keyframes shake { 0%, 100% { transform: translateX(0); } 20%, 60% { transform: translateX(-8px); } 40%, 80% { transform: translateX(8px); } }
    @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.2; filter: blur(2px); } }
    @keyframes comboPop { 0% { opacity: 0; transform: scale(0.5) translateX(-20px); } 50% { transform: scale(1.2) translateX(0); } 100% { opacity: 1; transform: scale(1) translateX(0); } }
    @keyframes stampDown { 0% { opacity: 0; transform: translate(-50%, -50%) rotate(-12deg) scale(2.2); } 40% { opacity: 1; transform: translate(-50%, -50%) rotate(-12deg) scale(0.95); } 100% { opacity: 0.95; transform: translate(-50%, -50%) rotate(-12deg) scale(1); } }
    @keyframes dropDown { 0% { top: -110px; opacity: 0; transform: translateX(-50%) rotate(0deg); } 80% { top: 10px; opacity: 1; transform: translateX(-50%) rotate(20deg); } 100% { top: 20px; opacity: 0; transform: translateX(-50%) rotate(30deg); } }

    .shake-active { animation: shake 0.3s ease-in-out; }
    .blink-active { animation: blink 0.3s ease-in-out; }

    /* SAO Contract Cut-In & Bond System */
    .contract-cutin-overlay { position: absolute; inset: 0; z-index: 1800; display: flex; align-items: center; justify-content: center; pointer-events: none; overflow: hidden; animation: contract-overlay-fade ease-out forwards; }
    @keyframes contract-overlay-fade { 0% { opacity: 0; } 12% { opacity: 1; } 85% { opacity: 1; } 100% { opacity: 0; } }
    .contract-backdrop { position: absolute; inset: 0; background: linear-gradient(135deg, rgba(20, 10, 28, 0.85) 0%, rgba(246, 135, 179, 0.28) 50%, rgba(15, 23, 42, 0.88) 100%); backdrop-filter: blur(4px); }
    .contract-portraits-layer, .contract-Portraits-layer { position: absolute; inset: 0; display: flex; align-items: center; justify-content: space-between; padding: 0 8vw; }
    .contract-cutin-overlay.solo-mode .contract-portraits-layer, .contract-cutin-overlay.solo-mode .contract-Portraits-layer { justify-content: center; }
    .contract-portrait { display: flex; flex-direction: column; align-items: center; gap: 8px; filter: drop-shadow(0 0 24px rgba(246, 135, 179, 0.7)); }
    .contract-portrait img { width: 140px; height: 140px; object-fit: cover; border-radius: 50%; border: 4px solid #fbb6ce; background: #1a202c; }
    .contract-portrait.left-partner { animation: slide-in-left-partner 0.45s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
    .contract-portrait.right-partner { animation: slide-in-right-partner 0.45s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
    @keyframes slide-in-left-partner { from { transform: translateX(-120px) scale(0.85); opacity: 0; } to { transform: translateX(0) scale(1); opacity: 1; } }
    @keyframes slide-in-right-partner { from { transform: translateX(120px) scale(0.85); opacity: 0; } to { transform: translateX(0) scale(1); opacity: 1; } }
    .contract-partner-name { background: rgba(26, 32, 44, 0.9); color: #fff5f7; padding: 4px 14px; border-radius: 999px; font-size: 15px; font-weight: 700; border: 1px solid #f687b3; }

    .sao-modal-card { position: relative; z-index: 2; width: min(420px, 82vw); background: rgba(245, 247, 250, 0.95); border: 2px solid #cbd5e0; border-radius: 6px; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.65), 0 0 30px rgba(246, 135, 179, 0.55); color: #2d3748; overflow: hidden; animation: sao-modal-pop 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; }
    @keyframes sao-modal-pop { 0% { transform: scaleY(0.05) scaleX(0.6); opacity: 0; } 60% { transform: scaleY(1.04) scaleX(1.02); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
    .sao-modal-header { background: linear-gradient(90deg, #4a5568, #2d3748); color: #edf2f7; font-size: 12px; font-weight: 800; letter-spacing: 1.5px; padding: 8px 14px; text-align: center; border-bottom: 2px solid #f687b3; }
    .sao-modal-body { padding: 18px 20px 14px; text-align: center; }
    .sao-modal-couple { font-size: 20px; font-weight: 900; color: #1a202c; margin-bottom: 6px; display: flex; align-items: center; justify-content: center; gap: 10px; }
    .sao-modal-desc { font-size: 14px; color: #4a5568; font-weight: 600; }
    .sao-modal-footer { display: flex; justify-content: center; gap: 36px; padding: 10px 0 16px; background: rgba(237, 242, 247, 0.8); border-top: 1px solid #e2e8f0; }
    .sao-btn { width: 38px; height: 38px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 900; border: 2px solid #a0aec0; background: #fff; transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease; }
    .sao-btn-accept { color: #ed8936; border-color: #ed8936; }
    .sao-btn-accept.pressed { background: #ed8936; color: #fff; transform: scale(1.25); box-shadow: 0 0 20px #f6ad55, 0 0 35px #f687b3; }
    .sao-btn-cancel { color: #718096; }

    /* Persistent Marriage Bond Cover Shield */
    .bridal-cover-shield { position: absolute; inset: -10px; border: 3px solid #fbb6ce; border-radius: 14px; background: radial-gradient(circle, rgba(246, 135, 179, 0.35) 0%, transparent 75%); box-shadow: 0 0 20px #f687b3; display: flex; align-items: flex-start; justify-content: center; z-index: 20; pointer-events: none; }
    .bridal-cover-shield span { margin-top: -12px; background: #d53f8c; color: #fff; font-size: 11px; font-weight: 900; padding: 1px 8px; border-radius: 999px; border: 1px solid #fff; }

    /* Mother's Rosario 10-Hit Cross Emblem */
    .rosario-cross-mark { position: absolute; inset: -15px; z-index: 35; pointer-events: none; display: flex; align-items: center; justify-content: center; }
    .rosario-line { position: absolute; width: 140%; height: 5px; background: linear-gradient(90deg, transparent, #fff, var(--cross-color, #f687b3), #fff, transparent); box-shadow: 0 0 14px var(--cross-color, #f687b3), 0 0 24px var(--glow-color, #b794f4); border-radius: 999px; }
    .rosario-line.line-1 { --slash-angle: 38deg; transform: rotate(var(--slash-angle)); animation: rosario-slash-in 0.22s ease-out forwards; }
    .rosario-line.line-2 { --slash-angle: -38deg; transform: rotate(var(--slash-angle)); animation: rosario-slash-in 0.22s 0.08s ease-out backwards; }
    .rosario-core { width: 22px; height: 22px; border-radius: 50%; background: #fff; box-shadow: 0 0 20px #fff, 0 0 35px var(--cross-color, #f687b3); animation: rosario-core-pulse 0.4s infinite alternate; }
    .rosario-cross-mark.shatter { animation: rosario-shatter 0.4s ease-out forwards; }
    @keyframes rosario-slash-in { from { transform: rotate(var(--slash-angle, 38deg)) scaleX(0); opacity: 0; } to { transform: rotate(var(--slash-angle, 38deg)) scaleX(1); opacity: 1; } }
    @keyframes rosario-core-pulse { from { transform: scale(0.85); } to { transform: scale(1.35); } }
    @keyframes rosario-shatter { 0% { transform: scale(1); filter: brightness(2); opacity: 1; } 100% { transform: scale(2.1); filter: brightness(3) blur(4px); opacity: 0; } }

    /* Seek / Step Situation HUD Banner & Active Combat Highlights */
    .log-line.current-frame-log { background: rgba(79, 209, 197, 0.2); border-left: 3px solid #f6e05e !important; color: #fff; box-shadow: inset 0 0 12px rgba(246, 224, 94, 0.15); }
    .log-line.current-frame-log:hover { background: rgba(79, 209, 197, 0.3); border-left-color: #f6e05e; }
    .seek-situation-banner { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 75; background: rgba(15, 23, 42, 0.94); border: 1px solid #4fd1c5; border-top: 3px solid #f6e05e; border-radius: 10px; padding: 8px 16px; color: #f8fafc; box-shadow: 0 10px 25px rgba(0, 0, 0, 0.78), 0 0 15px rgba(79, 209, 197, 0.25); backdrop-filter: blur(6px); display: flex; flex-direction: column; gap: 4px; max-width: min(720px, 88vw); min-width: 280px; pointer-events: none; animation: slideInUp 0.15s ease-out forwards; }
    .seek-banner-header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; font-weight: 800; color: #a0aec0; border-bottom: 1px solid rgba(255, 255, 255, 0.1); padding-bottom: 4px; }
    .seek-turn-pill { background: #f6e05e; color: #1a202c; padding: 1px 7px; border-radius: 999px; font-size: 11px; font-weight: 900; letter-spacing: 0.5px; }
    .seek-skill-pill { background: rgba(79, 209, 197, 0.2); color: #81e6d9; border: 1px solid #4fd1c5; padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 800; }
    .seek-skill-context { font-size: 12px; color: #fbd38d; font-style: italic; opacity: 0.95; }
    .seek-banner-body { font-size: 14px; line-height: 1.45; color: #edf2f7; font-weight: 600; }
    .actor.seek-acting .avatar { border-color: #f6e05e !important; box-shadow: 0 0 18px #f6e05e, 0 0 30px rgba(246, 224, 94, 0.5) !important; }
    .actor.seek-targeted .avatar { border-color: #fc8181 !important; box-shadow: 0 0 18px #fc8181, 0 0 28px rgba(252, 129, 129, 0.6) !important; }

    /* True AOE Fan Shockwave & Multi-Projectile Barrage VFX */
    .aoe-fan-wave { position: absolute; width: 160px; height: 340px; pointer-events: none; z-index: 18; mix-blend-mode: screen; filter: blur(1px); }
    .aoe-fan-wave.wave-right { border-right: 14px solid var(--wave-color, #fc8181); border-top: 4px solid transparent; border-bottom: 4px solid transparent; border-radius: 0 180px 180px 0; box-shadow: 18px 0 28px -4px var(--wave-color, #fc8181), inset -14px 0 22px -6px #ffffff; }
    .aoe-fan-wave.wave-left { border-left: 14px solid var(--wave-color, #4fd1c5); border-top: 4px solid transparent; border-bottom: 4px solid transparent; border-radius: 180px 0 0 180px; box-shadow: -18px 0 28px -4px var(--wave-color, #4fd1c5), inset 14px 0 22px -6px #ffffff; }
    .aoe-projectile { position: absolute; width: 72px; height: 16px; border-radius: 999px; pointer-events: none; z-index: 19; mix-blend-mode: screen; background: linear-gradient(90deg, transparent 0%, var(--proj-color, #fc8181) 45%, #ffffff 90%, #ffffff 100%); box-shadow: 0 0 16px var(--proj-color, #fc8181), 0 0 28px #ffffff; transform-origin: center center; }

    /* Environmental Battlefield Hazard Wave & Scene Narration Subtitle Banner */
    .arena-field-wave { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 38; background: radial-gradient(circle at 50% 50%, rgba(229, 62, 62, 0.45) 0%, rgba(183, 28, 28, 0.22) 50%, transparent 80%); opacity: 0; animation: arenaFieldPulse 0.95s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
    @keyframes arenaFieldPulse { 0% { opacity: 0; transform: scale(0.65); } 30% { opacity: 1; transform: scale(1.04); } 70% { opacity: 0.85; transform: scale(1); } 100% { opacity: 0; transform: scale(1.15); filter: blur(4px); } }

    .scene-narration-banner { position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); max-width: 86%; padding: 8px 20px; background: rgba(15, 23, 42, 0.92); border: 1px solid rgba(226, 232, 240, 0.25); border-radius: 8px; color: #f1f5f9; font-family: "Yu Mincho", "Noto Serif TC", "PMingLiU", serif; font-size: 14px; font-style: italic; line-height: 1.6; text-align: center; letter-spacing: 0.5px; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9); box-shadow: 0 6px 20px rgba(0, 0, 0, 0.7); backdrop-filter: blur(4px); pointer-events: none; z-index: 55; animation: narrationFadeIn 0.35s ease-out forwards; white-space: pre-line; }
    .scene-narration-banner.fade-out { animation: narrationFadeOut 0.4s ease-in forwards; }
    @keyframes narrationFadeIn { from { opacity: 0; transform: translate(-50%, 10px); } to { opacity: 1; transform: translate(-50%, 0); } }
    @keyframes narrationFadeOut { from { opacity: 1; transform: translate(-50%, 0); } to { opacity: 0; transform: translate(-50%, -8px); } }


    /* Timeline Milestone Event Pins & Tooltips */
    .seek-track-wrapper { position: relative; flex: 1; display: flex; align-items: center; height: 32px; }
    .seek-track-wrapper input[type="range"] { width: 100%; margin: 0; position: relative; z-index: 2; }
    .seek-markers-layer { position: absolute; left: 7px; right: 7px; top: 0; height: 100%; pointer-events: none; z-index: 3; }
    .seek-pin { position: absolute; top: 1px; transform: translateX(-50%) scale(0.6); width: 10px; height: 10px; border-radius: 50%; border: 1.5px solid #fff; cursor: pointer; pointer-events: none; opacity: 0; padding: 0; transition: opacity 0.2s ease, transform 0.15s ease, box-shadow 0.15s ease; z-index: 4; }
    .seek-container:hover .seek-pin, .seek-track-wrapper:hover .seek-pin { opacity: 1; pointer-events: auto; transform: translateX(-50%) scale(1); }
    .seek-container:hover .seek-pin:hover, .seek-track-wrapper:hover .seek-pin:hover { transform: translateX(-50%) scale(1.65); z-index: 50; }
    .seek-pin.pin-ultimate { background: #f6e05e; box-shadow: 0 0 8px #f6e05e; }
    .seek-pin.pin-death { background: #fc8181; box-shadow: 0 0 8px #e53e3e; }
    .seek-pin.pin-rebirth { background: #48bb78; box-shadow: 0 0 10px #48bb78; }
    .seek-pin.pin-contract { background: #f687b3; box-shadow: 0 0 8px #f687b3; }
    .seek-pin.pin-summon { background: #63b3ed; box-shadow: 0 0 8px #63b3ed; }
    .seek-pin-tooltip { position: absolute; top: 20px; left: 50%; transform: translateX(-50%) translateY(-4px); background: rgba(15, 23, 42, 0.98); color: #f8fafc; border: 1px solid #4fd1c5; border-radius: 6px; padding: 6px 10px; font-size: 12px; font-weight: 600; white-space: nowrap; pointer-events: none; opacity: 0; visibility: hidden; transition: opacity 0.15s ease, transform 0.15s ease; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.9); z-index: 9999; text-align: left; }
    .seek-pin-tooltip.tooltip-align-left { left: 0; transform: translateY(-4px); }
    .seek-pin-tooltip.tooltip-align-right { left: auto; right: 0; transform: translateY(-4px); }
    .seek-pin:hover .seek-pin-tooltip { opacity: 1; visibility: visible; transform: translateX(-50%) translateY(0); }
    .seek-pin:hover .seek-pin-tooltip.tooltip-align-left { transform: translateY(0); }
    .seek-pin:hover .seek-pin-tooltip.tooltip-align-right { transform: translateY(0); }
    .seek-pin-tooltip-title { color: #f6e05e; font-weight: 800; margin-bottom: 2px; display: block; }
    .seek-pin-tooltip-detail { color: #cbd5e1; font-size: 11px; font-weight: 500; display: block; max-width: 280px; overflow: hidden; text-overflow: ellipsis; }

    /* Report Export/Import Buttons, Hotkey Popover & Drag-Drop Overlay */
    button.btn-io { background: #2b6cb0; border-color: #63b3ed; padding: 6px 10px; color: #ebf8ff; }
    button.btn-io:hover { background: #3182ce; }
    .hotkey-wrapper { position: relative; display: inline-flex; align-items: center; }
    button.btn-hotkey { background: #1a202c; border-color: #4a5568; padding: 6px 9px; color: #a0aec0; font-size: 12px; }
    button.btn-hotkey:hover { color: #fff; border-color: #4fd1c5; }
    .hotkey-popover { position: absolute; top: calc(100% + 8px); right: 0; background: rgba(15, 23, 42, 0.97); border: 1px solid #4fd1c5; border-radius: 8px; padding: 10px 14px; color: #e2e8f0; font-size: 12px; line-height: 1.7; white-space: nowrap; box-shadow: 0 12px 28px rgba(0,0,0,0.85); z-index: 2600; opacity: 0; visibility: hidden; pointer-events: none; transition: opacity 0.15s ease; min-width: 250px; }
    .hotkey-wrapper:hover .hotkey-popover { opacity: 1; visibility: visible; }
    .hotkey-title { font-weight: 800; color: #4fd1c5; border-bottom: 1px solid rgba(255,255,255,0.12); padding-bottom: 3px; margin-bottom: 4px; font-size: 12px; }
    .hotkey-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
    .hotkey-popover kbd, .hotkey-kbd { background: #2d3748; border: 1px solid #718096; border-radius: 4px; padding: 0px 6px; font-family: monospace; font-size: 11px; color: #f6e05e; }
    .drag-drop-overlay { position: absolute; inset: 0; background: rgba(15, 23, 42, 0.88); border: 4px dashed #4fd1c5; z-index: 4000; display: none; align-items: center; justify-content: center; color: #f6e05e; pointer-events: none; backdrop-filter: blur(4px); }
    .drag-drop-overlay.active { display: flex; }
    .drag-drop-box { text-align: center; padding: 28px 40px; border-radius: 16px; background: rgba(26, 32, 44, 0.9); border: 1px solid rgba(79, 209, 197, 0.5); box-shadow: 0 20px 50px rgba(0,0,0,0.8); }
    .drag-drop-title { font-size: 26px; font-weight: 900; color: #f6e05e; letter-spacing: 1.5px; margin-bottom: 8px; }
    .drag-drop-sub { font-size: 14px; color: #cbd5e1; font-weight: 600; }
`;


