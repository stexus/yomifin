const { withXcodeProject } = require("@expo/config-plugins");

/**
 * Expo config plugin that sets `ENABLE_USER_SCRIPT_SANDBOXING = NO` for every
 * build configuration in the iOS Xcode project.
 *
 * Xcode 15+ (and especially Xcode 26) defaults this setting to YES, which runs
 * each build-phase shell script inside a sandbox that denies file writes. React
 * Native's "Bundle React Native code and images" phase writes a packager-IP
 * file (`ip.txt`) into the .app bundle, so the sandboxed build fails with:
 *
 *   error: Sandbox: bash(...) deny(1) file-write-create .../Streamyfin.app/ip.txt
 *
 * Disabling the sandbox is the standard React Native / Expo workaround. Without
 * this plugin the fix has to be applied by hand after every `expo prebuild`
 * (which regenerates ios/ and resets the setting back to YES).
 */
const withDisableScriptSandboxing = (config) => {
  return withXcodeProject(config, (config) => {
    const project = config.modResults;
    const configurations = project.pbxXCBuildConfigurationSection();

    let count = 0;
    for (const key of Object.keys(configurations)) {
      const entry = configurations[key];
      // Skip comment entries (keys ending in `_comment`) and malformed nodes.
      if (!entry || typeof entry !== "object" || !entry.buildSettings) {
        continue;
      }
      entry.buildSettings.ENABLE_USER_SCRIPT_SANDBOXING = "NO";
      count += 1;
    }

    console.log(
      `[withDisableScriptSandboxing] Set ENABLE_USER_SCRIPT_SANDBOXING=NO on ${count} build configuration(s)`,
    );

    return config;
  });
};

module.exports = withDisableScriptSandboxing;
