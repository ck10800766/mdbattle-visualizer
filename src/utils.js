// ==========================================
// FILE: src/utils.js
// ==========================================

/**
 * Escapes special characters in a string for safe interpolation inside a RegExp constructor.
 * @param {string} str - Raw input string.
 * @returns {string} RegExp-escaped string.
 */
export function escapeRegExp(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Escapes HTML special characters to prevent XSS or markup corruption before injecting spans.
 * @param {string} str - Raw input string.
 * @returns {string} HTML-escaped string.
 */
export function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Highlights all registered actor names in a combat log message in a single regex pass
 * without corrupting HTML entities or overlapping substring names.
 * @param {string} rawMessage - Raw log message text.
 * @param {Map<string, object>} actorsMap - Map of registered actor entities.
 * @returns {string} HTML string with actor names wrapped in side-colored spans.
 */
export function formatLogMessage(rawMessage, actorsMap) {
    const safeMsg = escapeHtml(rawMessage);
    const sortedActors = Array.from(actorsMap.values())
        .filter(a => a && a.name)
        .sort((a, b) => b.name.length - a.name.length);

    if (sortedActors.length === 0) return safeMsg;

    const sideByEscapedName = new Map();
    const patterns = [];

    sortedActors.forEach(actor => {
        const escapedHtmlName = escapeHtml(actor.name);
        if (!sideByEscapedName.has(escapedHtmlName)) {
            sideByEscapedName.set(escapedHtmlName, actor.side);
            patterns.push(escapeRegExp(escapedHtmlName));
        }
    });

    if (patterns.length === 0) return safeMsg;

    const regex = new RegExp(`(${patterns.join('|')})`, 'g');
    return safeMsg.replace(regex, (match) => {
        const side = sideByEscapedName.get(match);
        const nameClass = side === 'left' ? 'actor-name-left' : 'actor-name-right';
        return `<span class="${nameClass}">${match}</span>`;
    });
}