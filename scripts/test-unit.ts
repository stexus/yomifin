import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Upstream uses Jest/Expo. Fork-only Bun specs and standalone language tests
// retain their own runtimes; never discover ignored native/reference checkouts.
const files = [
  ...new Set(
    execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      {
        encoding: "utf8",
      },
    ).split("\0"),
  ),
].filter(
  (path) =>
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(path) &&
    !path.startsWith("utils/yomifin/") &&
    !path.startsWith("utils/yozora/"),
);

if (files.length === 0) throw new Error("No repository unit tests found");
const bunFiles = files.filter((path) =>
  readFileSync(path, "utf8").includes('from "bun:test"'),
);
const jestFiles = files.filter((path) => !bunFiles.includes(path));
const jestResult = spawnSync(
  "bun",
  ["run", "jest", "--runTestsByPath", "--maxWorkers=4", ...jestFiles],
  { stdio: "inherit" },
);
if (jestResult.error) throw jestResult.error;
if (jestResult.status !== 0) process.exit(jestResult.status ?? 1);
// UI specs replace native views with React hosts. Bun module mocks are global,
// so isolate these from utility specs' different native stubs.
const uiFiles = bunFiles.filter((path) => path.endsWith(".ui.test.tsx"));
const batches = [
  bunFiles.filter((path) => !uiFiles.includes(path)),
  ...uiFiles.map((path) => [path]),
];
for (const batch of batches) {
  if (!batch.length) continue;
  const result = spawnSync(
    process.execPath,
    ["test", ...batch.map((path) => `./${path}`)],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
