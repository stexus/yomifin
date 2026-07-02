/*
 * Minimal logging shim for the harvested Yomitan deinflector.
 *
 * Yomitan's real core/log.js pulls in EventDispatcher + ExtensionError (browser
 * extension plumbing). The deinflector only needs log.warn(error) for cycle
 * detection, so we provide a tiny console-backed stand-in instead of harvesting
 * the whole logging stack. See docs/yomifin/archive/PHASE2_YOMITAN.md.
 */

export const log = {
    /** @param {unknown} message @param {...unknown} optionalParams */
    log(message, ...optionalParams) {
        console.log(message, ...optionalParams);
    },
    /** @param {unknown} error */
    warn(error) {
        console.warn(error);
    },
    /** @param {unknown} error */
    error(error) {
        console.error(error);
    },
};
