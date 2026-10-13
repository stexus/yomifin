# Yomifin development and FlareStore distribution

## Current status (2026-10-13)

The repository implementation is installed: separate app identities, Metro and
IPA commands, native-project identity checks, and the GitHub publishing workflow.
A local Debug device IPA was built successfully and inspected: its ID is
`com.massimotseng.yomifin.dev`, its name is Yomifin Dev, and it has no embedded
application `main.jsbundle`. Type checking, Biome, and focused source/agent-doc
checks passed. GitHub Actions is enabled; pushing `yomifin-dev-20261013-1`
triggered the [first cloud build](https://github.com/stexus/yomifin/actions/runs/38465412709).
Source publication and physical-iPad validation are pending.

The previous copy-and-edit setup instructions are superseded. Future agents
should use the actual scripts and workflow, not recreate them from templates.

## The user's required workflow

| | Stable | Development |
| --- | --- | --- |
| Display name | Yomifin | Yomifin Dev |
| Bundle ID | `com.massimotseng.yomifin` | `com.massimotseng.yomifin.dev` |
| Xcode configuration | Release | Debug with Expo development client |
| App JavaScript | Bundled in IPA | Served by Metro; omitted from IPA |
| Computer required while using it | No | Yes, running Metro |
| Signing and installation | FlareStore | FlareStore |

Separate IDs permit side-by-side installation. Local settings, dictionaries,
caches, and downloads are separate. Jellyfin watch state and Anki cards still
belong to their shared servers. Preserve stable's installed identity and data.
A standalone preview build does not meet the user's development requirement.
Expo's launcher has its own resources; Yomifin's app bundle must be absent.

## Steps the user performs

No GitHub setup or login is required: Actions is already enabled, Git SSH access
pushes build tags, and the workflow's built-in `GITHUB_TOKEN` publishes releases.

1. After the first successful publication, add the source below to FlareStore.
   Select **Yomifin Dev**, sign with the existing purchased certificate/profile,
   and install it. Keep its `.dev` bundle ID on subsequent installs. Confirm
   it appears beside the existing daily-use app.
2. Start Metro in the checkout being edited with `just dev` (enter `nix develop`
   first if Bun is not on PATH). Open Yomifin Dev and scan Metro's QR code or
   select its server. Keep the computer running while developing.

Planned source URL (available only after publishing):

```text
https://github.com/stexus/yomifin/releases/download/yomifin-source/source.json
```

Agents must use the workflow token for publishing, not ask for personal
GitHub credentials. Public workflow status and releases can be inspected without
authentication.

The user must approve iPad installation prompts and verify the app on their
physical device. Agents should handle configuration, building, validation, and
GitHub operations whenever authorized access is available; do not hand the user
copying, editing, or CI setup work that can be completed here.

## Commands that now exist

Run from the repository root with the JS toolchain available:

```bash
just dev          # Metro for .dev, LAN mode, explicit yomifin-dev URL scheme
just ipa-dev      # build/development/Yomifin-Dev.ipa (unsigned Debug)
just ipa-stable   # build/stable/Yomifin.ipa (unsigned standalone Release)
just ipa          # alias for ipa-stable
```

Native builds require macOS and Xcode. Metro can also run on Linux if the iPad
can reach that machine. `just local` and `just remote` use the development
identity too, but retain their legacy Xcode/Personal Team signing flow; they do
not select the purchased FlareStore certificate automatically.

The local development IPA can be imported directly into FlareStore while GitHub
setup is pending. Publishing through the source removes that manual transfer
from subsequent installs.

## Connecting Metro

Put the iPad on a network that can reach the Metro host. Allow Local Network
access for Yomifin Dev. For a manual connection use
`http://<computer-LAN-IP>:8081`, not `localhost` on the iPad. The previously
recorded Mac mini address is `10.0.0.99`; verify that it is still current.

In iPad Safari, `http://<computer-LAN-IP>:8081/status` should return
`packager-status:running`. If it does not, check the address, firewall, Local
Network permission, and guest-Wi-Fi client isolation. An optional tunnel is:

```bash
APP_VARIANT=development EXPO_TV=0 bunx expo start --dev-client --tunnel --scheme yomifin-dev
```

Follow Expo's tunnel-dependency prompt if needed. Tunnels require internet and
may be slower. Most JS/TS edits use Fast Refresh; some need a full JS reload.
Metro serves its own checkout. If editing via SSH, that is the remote checkout;
if editing on Linux but serving from the Mac, synchronize source first or serve
Metro directly from Linux.

## GitHub distribution

Use `.github/workflows/yomifin-distribute.yml`, named **Yomifin - FlareStore**.
The inherited `release.yml` is an upstream EAS/store submission workflow and is
not this distribution path. The fork's EAS account/project settings are still
upstream-specific; this flow does not need EAS.

The workflow can start from a pushed tag (`yomifin-dev-*` for development,
`yomifin-stable-*` for stable), so initial setup does not require changing the
repo's default branch. It also supports manual selection of a variant and build
branch after the workflow lands on the default branch (`develop` when checked
on 2026-10-05). GitHub builds committed code at the selected ref; it cannot build
uncommitted local edits. Agents should check for uncommitted native changes before
publishing a CI client intended to run the current local JavaScript.

For example, from a committed branch containing the desired native code:

```bash
git tag yomifin-dev-20261005-1
git push origin yomifin-dev-20261005-1
```

Choose a fresh tag for each build. Stable tags deliberately publish the daily-use
identity. Do not create one merely to test that the workflow runs.

Each run builds an unsigned device IPA, checks its identity and embedded-JS
presence, uploads a uniquely tagged release, and updates the shared `source.json`
asset on the `yomifin-source` release. Development is marked prerelease. Stable
publication is deliberate, after testing. The catalog preserves the other app
and recent version history. It appears with only the entries published so far.

Both variants use one concurrency group to avoid overwriting each other's source
updates. Keep the catalog release mutable and retain IPA releases referenced by
its version history. The workflow needs `contents: write` through the provided
GitHub token; no P12, provisioning profile, Expo token, or App Store credentials.
Keep downloads publicly accessible to FlareStore.

Run the workflow after native changes or when cutting a stable release. There is
no automatic native build for every JS commit. Publishing does not silently
install updates; FlareStore handles signing and installation on the iPad. If its
UI does not flag build-number-only changes, select and install the new version
from the source; stable marketing versions should be bumped for releases.

## Implementation details for future agents

- `app.config.ts` selects identities via `APP_VARIANT=development|stable`;
  default is stable, unknown values fail. The stable deep-link scheme remains
  `streamyfin`. Dev uses `yomifin-dev`, with Expo's generated scheme enabled only
  there. `just dev` explicitly selects `yomifin-dev` to avoid old stable installs
  that may still claim the generated Expo scheme.
- `scripts/ios/build-variant.sh` preserves Mac/Nix toolchain guards, installs
  frozen dependencies, initializes pinned submodules, clean-prebuilds iOS, and
  invokes the existing archive helper. Dev sets `SKIP_BUNDLING=1` and
  `SKIP_BUNDLING_METRO_IP=1` so a GitHub runner IP is not embedded either.
- The archive helper's `--production` flag selects IPA packaging and resets
  configuration. Dev therefore passes `--production --configuration Debug` in
  that order. A log saying Production Build Mode does not imply Release; check
  the configuration. `--no-bundler` alone does not disable embedding app JS.
- `scripts/ios/app-source.ts` reads the IPA's actual plist and ZIP entries. It
  rejects incorrect identities and bundling before local completion or catalog
  publication. Source versions and sizes come from the built IPA.
- `scripts/ensure-pods-linked.sh` checks both native-module linkage and app
  identity before legacy local/remote installs. Changing variants requires a
  clean prebuild. Never hand-edit generated `ios/`.
- Download activity extension IDs and app groups derive from the main ID.
  The purchased profile must permit the IDs and entitlements used. Inspect the
  exact signing error if installation fails; do not assume a purchased cert
  grants every entitlement or change Dev to the stable identity as a workaround.
- EAS development and simulator profiles also select `.dev` if that service is
  configured later. This work does not add Android or TV variants.

## When to rebuild

| Change | Action |
| --- | --- |
| React components, JS/TS logic, player UI | Fast Refresh or JS reload |
| JS-only dependencies, Metro/Babel config | Install dependencies, restart Metro; sometimes clear its cache |
| Swift/mpv code, native dependencies, new native module | Rebuild/reinstall Dev IPA, then reconnect Metro |
| IDs, entitlements, icons, native plugins | Clean prebuild and rebuild Dev IPA |
| Tested version for daily use | Publish/install stable Release IPA |

The dev binary must contain every native API used by the current JS checkout.
Missing native methods/modules are not fixed by refreshing Metro. Keep the
existing stable app available while investigating feature changes.

## Physical-device completion checks

- [x] Separate identities and commands implemented.
- [x] Local Debug IPA built with `.dev` ID and no app `main.jsbundle`.
- [ ] GitHub workflow enabled and source publicly downloadable.
- [ ] FlareStore installs Dev alongside stable with the purchased profile.
- [ ] Metro connects and a visible JS edit refreshes on the iPad.
- [ ] Stable starts and plays with Metro stopped; existing data is retained.
- [ ] A subsequent Dev update replaces Dev and preserves its local data.

Update this status and `YOMIFIN_CONTEXT.md` as external/device checks complete.

References: [Expo variants](https://docs.expo.dev/build-reference/variants/),
[development builds](https://docs.expo.dev/develop/development-builds/use-development-builds/),
[GitHub workflow authentication](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token),
[manual workflows](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow),
[AltStore sources](https://faq.altstore.io/developers/make-a-source),
[FlareStore iPadOS guide](https://flarestore.app/guide/ios/).
