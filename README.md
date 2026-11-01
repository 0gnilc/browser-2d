# Browser 2D desktop

Browser 2D is a pnpm monorepo with an Electron desktop host, a Vue 3/Pinia/Naive UI renderer, and a worker owning SQLite and local Google Chrome. Devices, materials, history, settings and task controls use one validated public API. AdsPower is not used. The retired `src/` and `electron/` implementation is preserved at Git commit `a0567c5` for behavior comparison.

Use Node 24, at least 24.5.0. CI pins 24.22.1. The repository pins pnpm 12.16.1 through `packageManager`.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

The task screen selects a business device or creates an account-free test device. The Devices route also starts/cancels individual tasks and runs selected devices in batches. Each batch item retains its own receipt; an unknown result pauses dispatch and preserves the command ID for query/retry. Chrome tasks open isolated local verification pages for three seconds, with a maximum of two executing devices and four reserved task pages. Install Google Chrome first. In Settings, choose a fresh Chrome launch or an explicit local debugging endpoint to borrow. Leave the executable path empty to detect an installed Chrome, or provide its full path. The application never opens your default browser profile. Page demand and nonsecret execution settings are frozen when a task is accepted. Cancellation acknowledges a durable intention; the screen shows completion only after cleanup. The other routes manage business data.

Development data is stored in `artifacts/dev-data`. Set `BROWSER2D_DATA_DIR` to an independent directory to isolate `data.db`. P3 uses this one database for business data and scheduling. An old P1 `synthetic.sqlite3` is left untouched and is no longer opened or imported as business history. Closing the window stops acceptance and active work, cleans owned resources, and exits on every OS.

A packaged application without that override retains the legacy business path `~/kys/data.db`. Before upgrading a recognized legacy database it requires confirmation that the old application is closed and then acquires SQLite exclusive access. It creates a verified backup before migrating. Do not launch a production package against your real data merely to run tests.

`pnpm dev:ui` previews the interface and explicitly reports work/business operations unavailable. `pnpm dev:worker` starts the Electron worker host without a window. Source, app build-config and shared TypeScript preset changes trigger a coordinated rebuild and shutdown before replacement. A failed build keeps the current worker; a failed shutdown prevents replacement. After changing dependency manifests, the lockfile, package-manager settings or the Node version, stop development, install dependencies and restart it.

`pnpm dev -- --inspect-ui` enables loopback renderer debugging for development. In this mode, enter `stop` on stdin to request coordinated shutdown. The Electron tests use this mode to exercise the actual source-rebuild coordinator on all supported hosts.

Owned Chrome profiles live beside the business database under `chrome-sessions/`. Their directories are removed after verified browser exit. Borrowed Chrome stays open; only the task context is disposed. The old file driver remains available for explicit regression tests with `BROWSER2D_EXECUTION=controlled` and isolated `BROWSER2D_DATA_DIR`; its resources live under `controlled-resources/`. Unresolved acquisition or cleanup continues to reserve capacity and blocks reuse of that device. Cleanup is attempted at most three times per worker lifetime; correct the underlying problem and restart to reconcile again. Recovery marks all previous nonterminal tasks interrupted and never automatically executes them again. An ambiguous launch or lost context creation response remains blocked even if a later observation looks empty. Recovery never guesses ownership or kills a PID read from disk.

Per-launch records under `worker-owners/` fence process replacement. A previous PID that is live or cannot be checked blocks takeover; a record never authorizes killing an unrelated process. PID reuse can therefore cause conservative refusal. Normal close allows ten seconds for cooperation and five seconds for forced termination and confirmed exit. Forced or uncertain termination is not reported as clean shutdown.

```sh
pnpm check
pnpm test
pnpm test:storage
pnpm test:credentials
pnpm test:updates
pnpm test:release
pnpm test:observer
pnpm test:electron
pnpm build
```

`test` runs component tests. `test:storage` uses installed Chrome, real SQLite databases and an independent resource service, including migration, WAL backup, commands, capacity, late acquisition and cleanup fixtures. `test:credentials` checks preserved legacy encryption, Chrome settings validation and concurrent process-ownership claims. `test:updates` verifies manual update controls, shutdown ordering, subscriptions and the pinned updater against a controlled loopback feed. `test:release` verifies metadata, checksums, evidence and staging refusal paths. These tests do not certify an installed version upgrade. `test:observer` verifies that browser observation preserves actual page dimensions. Worker integration test files run serially; individual scheduler tests still exercise concurrent devices. `test:electron` covers actual UI/IPC calls, CRUD, OS credentials, host/worker death, stalled driver phases, resource recovery and the real development restart coordinator. Set `BROWSER2D_CHROME_EXECUTABLE` to override the Chrome binary used by tests and package verification. CI provisions Chrome for Testing on each native runner. On Linux the legacy credential integration tests require an unlocked secret service; CI starts a disposable GNOME keyring under a private D-Bus session. `scripts/linux-secret-session.sh` is for that disposable test environment, not a replacement for your desktop keyring.

better-sqlite3 13 ships Node-API platform binaries. Tests validate the driver in Node and Electron. Packaging skips native rebuild and checks the pinned driver's prebuild policy before producing artifacts. A driver upgrade requires an explicit native-verification update.

Packaging runs in a disposable workspace and refuses a target that does not match the host OS and architecture. Preview mode strips production signing credentials. Packaging never uploads artifacts. Production mode requires explicit channel/feed configuration and native signing inputs.

```sh
pnpm package -- --target=mac-x64
pnpm dist -- --mode=preview --target=mac-x64
pnpm verify:package -- --target=mac-x64
```

Other targets are `mac-arm64`, `win-x64` and `linux-x64`. `package` creates a runnable app directory. `dist` defaults to unsigned preview distribution formats. Explicit production mode writes a separate candidate directory and fails if required signing inputs or a clean source revision are missing. `verify:package` physically copies the runnable application outside the checkout and starts it twice with production fuses. It verifies durable command replay/query, queue capacity, active/queued cancellation, business persistence, resource absence and worker exit. Its historical `--verify-p1` mode accepts only a dedicated temporary fixture directory. `pnpm verify:installation` additionally installs the DMG/NSIS/DEB preview artifact, launches it in place, uninstalls, reinstalls the same version against the same temporary data, and checks data retention after removal. Windows/Linux installation rehearsal runs only in disposable CI. Same-version reinstall is not an N-to-N+1 upgrade.

The native CI matrix in `.github/workflows/p1.yml` uses Windows, Intel macOS, Apple Silicon macOS and Ubuntu runners. A configured workflow is not proof of a passing target. Actual acceptance results are recorded separately.

The [P0/P1 acceptance record](docs/implementation/p0-p1-acceptance.md) links the successful native matrix and records the verified scope and remaining production-release work.

The [P2 acceptance record](docs/implementation/p2-acceptance.md) records the business migration, credential, native-platform and final-package checks, with the exact validated revisions and remaining phase boundaries.

The [P3 design](docs/implementation/p3-design.md) explains command receipts, reservations, resource recovery and process ownership. The [P3 acceptance record](docs/implementation/p3-acceptance.md) records the implemented scope and verification evidence.

Read [the approved plan](docs/monorepo-refactor-plan.md) and [P0 source baseline](docs/implementation/p0-baseline.md) for scope, data ownership and later migration stages. `packages/contracts` provides the only shared runtime contract. `internal` contains engineering tools. Desktop depends on the worker's compiled executable package; it never imports worker business code or opens the database.

[P2 implementation decisions](docs/implementation/p2-design.md) describe migration and credential ownership. Persistent credentials use OS encryption in `credentials.enc` under userData. Chrome settings no longer offer API-key storage. Existing encrypted references are preserved and do not gate Chrome startup. Legacy plaintext migration still requires working persistent encryption before removing the old plaintext value. Recovery backups deliberately preserve original data and may contain the old plaintext key. They are not automatically restored over a newer database.

The [P4 design](docs/implementation/p4-design.md) records direct Chrome ownership, isolated contexts, recovery boundaries and the removal of active AdsPower configuration. The [P4 acceptance record](docs/implementation/p4-acceptance.md) records the successful Windows, macOS Intel/ARM and Linux native matrix, copied-package browser checks and Fedora RPM installation. P5 and P6 results are recorded separately in [their acceptance record](docs/implementation/p5-p6-acceptance.md).

Read [the development guide](docs/development.md) for entry points, HMR and failure handling. Read [release engineering](docs/release.md) for production configuration and evidence requirements. `release:verify` rejects preview or incomplete evidence; `release:prepare` stages the exact verified four-target files without rebuilding. `release` refuses online publication because no publisher is configured.

Settings exposes manual check, download and confirmed installation for a configured production channel. Normal quit never installs an update. Installation first stops task admission and waits for worker/browser cleanup. Development, preview and DEB/RPM installations do not offer in-app updates. Signing certificates, Apple notarization credentials, an HTTPS feed and legacy Squirrel installation evidence are still required for formal distribution acceptance.

The [P0 through P6 audit](docs/implementation/p0-p6-acceptance.md) consolidates current acceptance and retained gaps. POSIX owned Chrome uses a private process group; cleanup waits for group disappearance before removing its profile. Unknown observations continue within the existing cleanup deadline. Versioned journal evidence distinguishes this from Windows child-only closure and ambiguous historical records. No stored PID or group receives a termination signal. The record also preserves one unreproduced Windows acquisition timeout as a reliability observation.
