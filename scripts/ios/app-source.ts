import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

type Variant = "development" | "stable";
type Version = {
  version: string;
  buildVersion: string;
  date: string;
  downloadURL: string;
  size: number;
  minOSVersion: string;
  localizedDescription: string;
};
type SourceApp = {
  bundleIdentifier: string;
  versions: Version[];
  [key: string]: unknown;
};
type Source = { apps: SourceApp[]; [key: string]: unknown };

export function parseVariant(value: string | undefined): Variant {
  if (value !== "development" && value !== "stable") {
    throw new Error(`Unknown APP_VARIANT: ${value}`);
  }
  return value;
}

export function inspectIpa(ipaPath: string, variant: Variant) {
  const entries = execFileSync("/usr/bin/unzip", ["-Z1", ipaPath], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  }).split("\n");
  const plists = entries.filter((name) =>
    /^Payload\/[^/]+\.app\/Info\.plist$/.test(name),
  );
  if (plists.length !== 1) {
    throw new Error("IPA must contain exactly one main application");
  }
  // plutil handles binary and XML plists without adding a parser dependency.
  const plist = execFileSync("/usr/bin/unzip", ["-p", ipaPath, plists[0]]);
  const info = JSON.parse(
    execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", "-"], {
      input: plist,
      encoding: "utf8",
    }),
  ) as Record<string, string>;
  const expectedId = `com.massimotseng.yomifin${variant === "development" ? ".dev" : ""}`;
  if (info.CFBundleIdentifier !== expectedId) {
    throw new Error(`Wrong app identity: expected ${expectedId}`);
  }
  const bundle = plists[0].replace(/Info\.plist$/, "main.jsbundle");
  if (entries.includes(bundle) !== (variant === "stable")) {
    throw new Error(`Unexpected embedded app JavaScript for ${variant}`);
  }
  for (const key of [
    "CFBundleShortVersionString",
    "CFBundleVersion",
    "MinimumOSVersion",
  ]) {
    if (typeof info[key] !== "string" || !info[key]) {
      throw new Error(`Missing IPA metadata: ${key}`);
    }
  }
  return {
    bundleIdentifier: expectedId,
    version: info.CFBundleShortVersionString,
    buildVersion: info.CFBundleVersion,
    minOSVersion: info.MinimumOSVersion,
    size: statSync(ipaPath).size,
  };
}

export function updateSource(
  source: Source | undefined,
  build: ReturnType<typeof inspectIpa> & {
    variant: Variant;
    repo: string;
    sha: string;
    tag: string;
    filename: string;
    date: string;
  },
): Source {
  if (source && !Array.isArray(source.apps)) {
    throw new Error("Invalid existing source catalog");
  }
  const catalog: Source = source ?? {
    name: "Yomifin",
    identifier: "com.massimotseng.yomifin.source",
    subtitle: "Stable and Metro development builds",
    website: `https://github.com/${build.repo}`,
    apps: [],
    news: [],
  };
  const version: Version = {
    version: build.version,
    buildVersion: build.buildVersion,
    date: build.date,
    downloadURL: `https://github.com/${build.repo}/releases/download/${build.tag}/${build.filename}`,
    size: build.size,
    minOSVersion: build.minOSVersion,
    localizedDescription: `${build.variant} native build from ${build.sha.slice(0, 7)}.`,
  };
  const oldApp = catalog.apps.find(
    (app) => app.bundleIdentifier === build.bundleIdentifier,
  );
  const history = (oldApp?.versions ?? []).filter(
    (item) =>
      item.version !== version.version ||
      item.buildVersion !== version.buildVersion,
  );
  const app: SourceApp = {
    name: build.variant === "development" ? "Yomifin Dev" : "Yomifin",
    bundleIdentifier: build.bundleIdentifier,
    developerName: "Massimo",
    localizedDescription:
      build.variant === "development"
        ? "Development client. Start Metro on your computer to use this app."
        : "Standalone daily-use Yomifin.",
    iconURL: `https://raw.githubusercontent.com/${build.repo}/${build.sha}/assets/images/icon-ios-plain.png`,
    screenshotURLs: [],
    versions: [version, ...history.slice(0, 9)],
    // Classic fields are used by source readers without versions[] support.
    version: version.version,
    versionDate: version.date,
    downloadURL: version.downloadURL,
    size: version.size,
  };
  return {
    ...catalog,
    apps: [
      ...catalog.apps.filter(
        (item) => item.bundleIdentifier !== build.bundleIdentifier,
      ),
      app,
    ].sort((a, b) => a.bundleIdentifier.localeCompare(b.bundleIdentifier)),
  };
}

if (import.meta.main) {
  const variant = parseVariant(process.env.APP_VARIANT);
  const ipaPath = process.env.IPA_PATH;
  if (!ipaPath) throw new Error("IPA_PATH is required");
  const metadata = inspectIpa(ipaPath, variant);
  console.log(
    `Validated ${metadata.bundleIdentifier} (${metadata.buildVersion})`,
  );
  if (!process.argv.includes("--validate-only")) {
    const required = (key: string) => {
      const value = process.env[key];
      if (!value) throw new Error(`${key} is required`);
      return value;
    };
    const sourcePath = "build/source.json";
    const source = existsSync(sourcePath)
      ? JSON.parse(readFileSync(sourcePath, "utf8"))
      : undefined;
    const updated = updateSource(source, {
      ...metadata,
      variant,
      repo: required("GITHUB_REPOSITORY"),
      sha: required("GITHUB_SHA"),
      tag: required("RELEASE_TAG"),
      filename: basename(ipaPath),
      date: new Date().toISOString(),
    });
    writeFileSync(sourcePath, `${JSON.stringify(updated, null, 2)}\n`);
  }
}
