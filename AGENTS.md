# Yomifin agent context

Read `CLAUDE.md` for repository conventions and `YOMIFIN_CONTEXT.md` for the
fork's architecture, device constraints, and current setup before working here.

For builds, installs, or development workflow, also read
`docs/yomifin/DEVELOPMENT_AND_DISTRIBUTION.md`.

The current fork development base is `sync/upstream-develop-2026-09-23`, with
the `setup/yomifin-flarestore` commits incorporated. The setup branch contains
all committed sync work; it is not a separate product line. Both app variants
build from the same source. `develop` and the old `yomifin` checkpoint are not
the current fork feature base. Preserve local uncommitted work, which GitHub
builds cannot include.

The user's chosen workflow is two iPad apps: stable
`com.massimotseng.yomifin` (standalone Release) and development
`com.massimotseng.yomifin.dev` (Debug Expo development client, app JavaScript
served by Metro with Fast Refresh). FlareStore signs and installs both using
the user's purchased certificate. GitHub should distribute stable releases
and occasional native development-client rebuilds through an app source.

The local config, commands, and publishing workflow are implemented. A local
Debug IPA was built and verified to omit the app JavaScript bundle. Check the
guide's status for GitHub publication and iPad installation; those are separate
validation gates. Handle builds and GitHub setup for the user when access permits.
Use existing Git SSH access to push build tags; Actions publishes with its own
`GITHUB_TOKEN`. Do not request GitHub CLI login, OAuth authorization, or a personal
token for this workflow. If Actions is disabled on the fork, the user only needs
to enable it in the repository's Actions tab.
Never install an experimental build over the stable identity. JS/TS-only work
normally needs Metro, while native changes require rebuilding the dev IPA.
Preserve unrelated work in progress; use Bun for repository commands.
