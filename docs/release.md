# Release candidates and acceptance

`pnpm dist` produces an unsigned preview by default. Preview runs never enable the updater and cannot pass `release:verify`. Signing credentials, notarization credentials and a production feed are not currently supplied. Final signed four-target acceptance remains open. No command in this repository uploads files.

## Build modes

```sh
pnpm dist -- --mode=preview --target=mac-x64
pnpm dist -- --mode=production --target=mac-x64 --channel=test --feed-base-url=https://updates.example.invalid/browser-2d
```

Use the native OS and architecture for `win-x64`, `mac-x64`, `mac-arm64` and `linux-x64`. Preview keeps the existing `release/<target>` layout. Production uses `release/production/<channel>/<target>`. Each invocation clears only its selected target output and builds in a temporary isolated source copy with a frozen lockfile. Production requires a clean Git revision and final distributables through `dist`; `package --mode=production` without `--dist` is rejected.

Production requires an explicit `stable` or `test` distribution audience and an HTTPS feed base without credentials, query or fragment. A target's feed is `<base>/<channel>/<target>/`. The audience does not change application identity, data paths or semver policy. Each target has its own default metadata filename. Windows uses `latest.yml`, macOS uses `latest-mac.yml`, and Linux uses `latest-linux.yml`.

`resources/release-config.json` is immutable packaged configuration. Preview contains only `{"mode":"preview"}`. Production contains `mode`, `channel`, `feedBaseUrl` and `target`. Runtime environment variables do not select an update server. Linux DEB/RPM installations use their package manager; only AppImage enables in-app update actions.

The frozen identities remain `io.github.0gnilc.browser2d.foundation`, `Browser2DFoundation` and `browser-2d-foundation`. Runtime app name, default userData and the explicit data-directory override are unchanged. See the [P0 identity baseline](implementation/p0-baseline.md).

| Target              | Required production inputs                                                                                                             | Final artifacts                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Windows x64         | `CSC_LINK`, `CSC_KEY_PASSWORD`, `BROWSER2D_WINDOWS_PUBLISHER` matching the certificate's common name                                   | Authenticode signed NSIS installer; publisher verification enabled in packaged `app-update.yml` |
| macOS Intel and ARM | `CSC_LINK`, `CSC_KEY_PASSWORD`, `CSC_NAME` naming Developer ID Application, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Developer ID signed app and DMG; notarized and stapled app and DMG; update ZIP                  |
| Linux x64           | Explicit channel and HTTPS feed                                                                                                        | AppImage, DEB and RPM; no native code-signing claim                                             |

Inputs are checked before isolated dependency installation or compilation. Preview removes signing and notarization inputs from its child environment and disables identity discovery. Production preserves signing discovery, enables mandatory signing on Windows/macOS, uses builder 26's `win.signtoolOptions.publisherName`, and verifies the same publisher at runtime. Both modes pass `--publish never`.

Builder notarizes the macOS application. Packaging separately submits and staples the signed DMG before computing the final inventory. Stapling changes DMG bytes, so its obsolete sidecar blockmap and DMG update reference are removed before hashing. In-app macOS updates use the unchanged ZIP and its metadata. `notarization.json` records the DMG submission ID; secrets are never written there.

`build-context.json` records the exact commit, dirty status, lockfile SHA256, desktop version, target, mode, public release configuration, frozen identity, Node/package-manager versions and installed Electron/builder/updater versions. `artifact-inventory.json` records names, sizes, SHA256 and base64 SHA512 for final installers, update archives, sidecar blockmaps and metadata. Neither file claims acceptance.

## Verify existing final files

```sh
pnpm release:verify -- --directory=/absolute/path/release/production/test/mac-x64 --evidence=/absolute/path/native-mac-x64-evidence
```

Run verification on the target's native OS and architecture. It never builds, installs, signs, notarizes or uploads an artifact. macOS verification mounts the DMG read-only and extracts the ZIP into a temporary directory. It checks Developer ID, bundle identifier, signing team, strict signatures, Gatekeeper, stapling, application version, packaged feed configuration and identical DMG/ZIP application archives. Windows checks Authenticode trust, certificate publisher and signed version on the installer and packaged executable, plus the packaged updater's publisher identity. Linux reads DEB/RPM versions and architecture without installing them.

The verifier rejects preview mode, dirty production provenance, changed inventory, missing final formats, duplicate or unexpected metadata, duplicate YAML keys, URL/traversal references, version/size/SHA512 disagreement and missing external acceptance evidence. Installer and ZIP/AppImage hashes bind external behavior reports to these exact final files. Paths must name regular files contained in their evidence directory. Symbolic links are rejected.

A successful verification writes `native-verification.json` with actual native tool commands and output and `release-receipt.json` with the exact artifact, provenance and evidence digests. A failed rerun removes the old receipt. A receipt is a local verification record, not a cryptographic attestation from an independent signer. Preserve its native logs and the external runner evidence for review.

## External native evidence

Each native candidate requires an externally produced `release-acceptance.json` and the nonempty logs it names. Preview package checks, component tests, fake updater adapters and installation/reinstallation harness results do not establish signed N→N+1 update acceptance. A preview report cannot be relabeled as production evidence.

The report uses `schemaVersion: 1` and repeats `target`, `sourceCommit`, `lockSha256`, `version` and the exact `files` array from the candidate's inventory. `runner.platform` and `runner.arch` must match the native target. Each entry in `scenarios` includes the executed `command` argument array, numeric `exitCode`, a `log` with a contained filename and SHA256, and these measured `observations`.

| Scenario           | Required observations                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `install`          | `installedVersion` equals the candidate version                                                                                                                                       |
| `upgrade`          | A distinct `fromVersion` and candidate `toVersion`                                                                                                                                    |
| `controlledFeed`   | The same origin and destination versions, `downloadedFile` and `downloadedSha512` matching a final candidate payload, and `failureCases` containing `offline`, `http-404`, `checksum` |
| `dataRetention`    | Nonempty fixture `beforeSha256` and identical `afterSha256` across the upgrade                                                                                                        |
| `uninstall`        | `remainingInstallationPaths` is an empty array                                                                                                                                        |
| `shutdown`         | Nonempty `ownedPidsBefore`, empty `ownedPidsAfter`, and `workerExitCode: 0`; independently observe worker/browser cleanup before installer handoff                                    |
| `packageIsolation` | Candidate `installedVersion` and empty `sourcePathsAccessed`, from execution outside the checkout                                                                                     |

The scenario logs must establish the observations on the final native artifacts and include the executed tests' actual results. The validator checks their presence, binding and integrity. It does not turn invented JSON or an unreviewed human assertion into a real installation test. No `passed: true` or `verified: true` field replaces a scenario or a signature check. The repository does not yet produce complete signed external upgrade reports. Until those real runs exist, receipt generation stays blocked.

`legacySquirrel` defaults to unknown through absence of evidence. The repository's old Forge configuration does not prove there were no installations. A release owner may supply `status: "none-attested"`, an accountable `author`, and a separately hashed nonempty `evidence` document identifying the distribution history. If Squirrel users exist, use `status: "migration-verified"`, `target: "win-x64"` and `checked` containing `shortcuts`, `registration`, `uninstall`, `data-retention`, backed by the Windows migration exercise. Preserve and review that Windows evidence for all four target reports. No such attestation has been supplied in this phase.

## Stage the same four verified candidates

```sh
pnpm release:prepare -- --directory=/absolute/path/release/production/test --staging=/absolute/path/new-empty-staging
```

Preparation requires four target receipts with one commit, lockfile, version, audience and feed base. It rehashes every candidate, checks metadata and acceptance evidence again, and copies only the exact verified files plus their provenance into a new empty directory outside the candidate tree. It checks hashes before and after copying. It never invokes builder, alters versions, regenerates metadata, signs files or uploads anything.

`upload-manifest.json` distinguishes payloads, metadata to publish last, and provenance that should remain outside the public update feed. Future upload tooling must rehash this exact inventory and require an authorized destination. `pnpm release` currently fails explicitly because no upload destination is configured or authorized. Staging is not publication.

## CI and remaining gates

The manual `Release candidates (no publication)` workflow exposes explicit mode, audience and feed inputs and builds four native targets. Production preflight runs before dependency installation. Missing signing/notarization/feed inputs fail instead of falling back to preview. The workflow archives candidates and does not mint release receipts or publish releases. It complements the existing test/package matrix; it does not replace it.

The remaining gates are real final signed native artifacts, four-target install and N→N+1 upgrade acceptance, controlled HTTPS feed failures and checksum behavior, retained user data, uninstall, cleanup before installer handoff, execution without the checkout, and the old Squirrel distribution decision. No real installation is performed on the user's host by this engineering work.
