# Build and verify release candidates

## Build preview artifacts

Run on the target operating system and architecture. `internal/build-config/release.mjs` defines all four targets and the product identity.

```sh
pnpm dist -- --target=mac-arm64
```

The other targets are `mac-x64`, `win-x64`, and `linux-x64`. Preview formats are macOS DMG and ZIP, Windows NSIS, and Linux AppImage, DEB, and RPM. `pnpm package` creates an unpacked application. Outputs are under `release/<target>`.

Packaging installs the pinned lockfile and builds in a fresh temporary source copy. It does not reuse development outputs. `build-context.json` binds the source revision, dirty state, lockfile, target, and tools. `artifact-inventory.json` hashes the final artifacts. Build from a clean commit for exact format acceptance.

## Verify the artifacts

```sh
pnpm verify:package -- --target=mac-arm64
pnpm verify:installation
pnpm verify:formats -- --target=mac-arm64
```

`verify:package` copies the application outside the checkout, verifies ASAR, native binaries, fuses, private chunks, bundled workspace code, and exact migration bytes, then executes process isolation and the Browser/Card workbench twice. It also tests the native default userData namespace without `BROWSER2D_DATA_DIR`.

The default-path test supplies a dedicated temporary `appData` base through the guarded private verification flag. Electron derives `<appData>/Browser 2D`, and the database must appear at `data/app.sqlite`. The test does not change HOME, create operating-system users, or touch the user's existing default namespace. This proves Electron's native path derivation within an isolated base.

`verify:installation` installs, launches, uninstalls, reinstalls the same version, launches again, and checks that uninstall preserves data. Windows and Linux installation runs require disposable CI runners. macOS uses a temporary installed app directory. `verify:formats` runs the exact macOS ZIP or the Linux AppImage through FUSE. It rejects extraction fallback for the actual AppImage launch. Fedora RPM acceptance installs in a disposable container and runs as its existing `nobody` account.

`verify:package -- --process-only` is a separately named scope. It checks the static package and process isolation without claiming full UI or installer acceptance. The CI workflow has separate concurrency groups and artifact names for this scope. Ordinary CI and workflow dispatch default to full acceptance on all four native targets, followed by the aggregate job.

## Prepare a production candidate

Production requires clean source, a selected channel, a trusted HTTPS feed, and platform signing inputs. Missing inputs fail before packaging. The exact required variables are defined by `validateProductionInputs` and provided only to the corresponding platform steps in the candidate workflow.

```sh
pnpm dist -- --mode=production --target=mac-arm64 --channel=test --feed-base-url=https://updates.example.invalid/browser-2d
```

Replace the example feed with the real service. Production output is under `release/production/<channel>/<target>`. The feed configuration is packaged and cannot be replaced through runtime environment variables. macOS finalizes notarization and stapling before artifact hashes are recorded.

## Verify and stage production files

```sh
pnpm release:verify -- --directory=/absolute/path/release/production/test/mac-arm64 --evidence=/absolute/path/native-evidence
pnpm release:prepare -- --directory=/absolute/path/release/production/test --staging=/absolute/path/new-empty-staging
```

The release verifier checks existing final files and the evidence bound to their hashes. It does not build, sign, install, or upload. The staging tool requires four valid native receipts with matching source and lockfile, copies the final files, and checks the hashes again. The release workflow archives candidates only. `pnpm release` refuses unconfigured publication.

Preview installation and same-version reinstall do not certify a real N-to-N+1 upgrade. Formal Windows signing, Apple signing and notarization, a production HTTPS updater, independent native production evidence, and official release remain open external requirements in [Issue 6](https://github.com/0gnilc/browser-2d/issues/6). Do not treat preview reports or synthetic release-tool fixtures as those certificates.
