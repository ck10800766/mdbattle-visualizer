// ==========================================
// FILE: src/constants.js
// ==========================================
/**
 * @fileoverview Centralized configuration constants for API endpoints, asset URLs,
 * host page DOM selectors, and playback speed presets.
 */

/**
 * Base URL for the game's backend API used when fetching supplementary battle report metadata.
 * @type {string}
 */
export const API_BASE = 'https://mydoujin-backend.onrender.com';

/**
 * Base origin for relative character and boss avatar image paths.
 * @type {string}
 */
export const ASSET_HOST = 'https://mydoujin.online';

/**
 * Fallback placeholder image URL when an actor's avatar is missing or fails to load.
 * @type {string}
 */
export const DEFAULT_AVATAR_URL = 'https://via.placeholder.com/150';

/**
 * Fallback placeholder image URL for the large MVP splash portrait.
 * @type {string}
 */
export const DEFAULT_MVP_AVATAR_URL = 'https://via.placeholder.com/600';

/**
 * Selectors used to locate the underlying host page content container to hide while the stage is active.
 * @type {string}
 */
export const HOST_CONTENT_SELECTOR = '.css-1svsvwq';

/**
 * Available user-selectable playback speed multipliers cycled by the stage speed button.
 * @type {ReadonlyArray<number>}
 */
export const PLAYBACK_SPEEDS = Object.freeze([1, 2, 4, 8]);

