import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { inspectIpa, parseVariant, updateSource } from "./app-source";

const devBuild = {
  variant: "development" as const,
  bundleIdentifier: "com.massimotseng.yomifin.dev",
  version: "0.55.0",
  buildVersion: "1.1",
  minOSVersion: "16.4",
  size: 123,
  repo: "stexus/yomifin",
  sha: "abcdef1234",
  tag: "dev-1",
  filename: "Yomifin-Dev.ipa",
  date: "2026-10-05T00:00:00Z",
};

test("publishing Dev preserves stable and keeps prior Dev downloads", () => {
  const initial = updateSource(undefined, devBuild);
  const both = updateSource(initial, {
    ...devBuild,
    variant: "stable",
    bundleIdentifier: "com.massimotseng.yomifin",
    filename: "Yomifin.ipa",
  });
  const updated = updateSource(both, {
    ...devBuild,
    buildVersion: "2.1",
    tag: "dev-2",
  });
  expect(updated.apps[0]).toEqual(both.apps[0]);
  expect(updated.apps[1].versions.map((v) => v.buildVersion)).toEqual([
    "2.1",
    "1.1",
  ]);
  expect(updated.apps[1].versions[1].downloadURL).toContain("/dev-1/");
  expect(both.apps[1].versions).toHaveLength(1);
});

test("retrying the same version does not duplicate the catalog entry", () => {
  const initial = updateSource(undefined, devBuild);
  const retry = updateSource(initial, devBuild);
  expect(retry.apps).toHaveLength(1);
  expect(retry.apps[0].versions).toHaveLength(1);
});

test("unknown or missing variant fails instead of choosing stable", () => {
  expect(() => parseVariant("devlopment")).toThrow("Unknown APP_VARIANT");
  expect(() => parseVariant(undefined)).toThrow("Unknown APP_VARIANT");
});

const tempDirs: string[] = [];
afterEach(() => {
  for (const path of tempDirs.splice(0)) rmSync(path, { recursive: true });
});

function fixture(bundleId: string, bundled: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "yomifin-ipa-test-"));
  tempDirs.push(dir);
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
    <plist version="1.0"><dict>
    <key>CFBundleIdentifier</key><string>${bundleId}</string>
    <key>CFBundleShortVersionString</key><string>0.55.0</string>
    <key>CFBundleVersion</key><string>2.1</string>
    <key>MinimumOSVersion</key><string>16.4</string>
    </dict></plist>`;
  const entries: Record<string, Uint8Array> = {
    "Payload/Test.app/Info.plist": strToU8(plist),
    "Payload/Test.app/PlugIns/Activity.appex/Info.plist": strToU8(plist),
  };
  if (bundled) entries["Payload/Test.app/main.jsbundle"] = strToU8("js");
  const path = join(dir, "Test.ipa");
  writeFileSync(path, zipSync(entries));
  return path;
}

test.skipIf(process.platform !== "darwin")(
  "IPA verification prevents development from using the stable identity",
  () => {
    expect(() =>
      inspectIpa(fixture("com.massimotseng.yomifin", false), "development"),
    ).toThrow("Wrong app identity");
  },
);

test.skipIf(process.platform !== "darwin")(
  "IPA verification requires Metro-only Dev and bundled stable",
  () => {
    expect(
      inspectIpa(fixture(devBuild.bundleIdentifier, false), "development")
        .buildVersion,
    ).toBe("2.1");
    expect(() =>
      inspectIpa(fixture(devBuild.bundleIdentifier, true), "development"),
    ).toThrow("Unexpected embedded");
    expect(() =>
      inspectIpa(fixture("com.massimotseng.yomifin", false), "stable"),
    ).toThrow("Unexpected embedded");
    expect(
      inspectIpa(fixture("com.massimotseng.yomifin", true), "stable").version,
    ).toBe("0.55.0");
  },
);
