import { execFileSync, spawnSync } from "node:child_process";

// Bare `bun test` also discovers ignored native builds and the local Yomitan
// checkout. The fork's standalone regression scripts run separately because
// they own their process lifecycle; they must not terminate Bun's test runner.
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
const result = spawnSync(
  process.execPath,
  ["test", ...files.map((path) => `./${path}`)],
  {
    stdio: "inherit",
  },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
