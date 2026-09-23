const { withEntitlementsPlist } = require("expo/config-plugins");

/**
 * Strips iOS entitlements that require a PAID Apple Developer account.
 *
 * On a free personal team, the provisioning profile cannot grant these
 * capabilities, so codesign fails with:
 *   "Provisioning Profile ... does not support the <X> capability."
 *
 * Removing them lets free-account development builds sign and install on a
 * physical device. The corresponding features (push, Wi-Fi info) simply don't
 * work on a free build — acceptable for the yomifin personal/dev workflow.
 *
 * This plugin must run AFTER any plugin that ADDS these entitlements (e.g.
 * expo-notifications adds aps-environment). Expo executes later-registered
 * entitlement mods first, so keep this plugin FIRST in app.json's `plugins`
 * array. If you move to a paid team, drop this plugin.
 */
const PAID_ENTITLEMENTS = [
  "aps-environment", // Push Notifications
  "com.apple.developer.networking.wifi-info", // Access Wi-Fi Information
];

const withFreeAccountEntitlements = (config) => {
  return withEntitlementsPlist(config, (config) => {
    for (const key of PAID_ENTITLEMENTS) {
      if (key in config.modResults) {
        delete config.modResults[key];
        console.log(`[withFreeAccountEntitlements] Removed ${key}`);
      }
    }
    return config;
  });
};

module.exports = withFreeAccountEntitlements;
