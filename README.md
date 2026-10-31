# Browser 2D desktop

P0/P1 provides the desktop foundation. P2 adds device, material, history and settings operations through the sandboxed preload and worker-owned SQLite. P3 adds durable scheduling and recovery using controlled tasks. P4 connects puppeteer-core directly to local Google Chrome. AdsPower is not used. The retired `src/` and `electron/` implementation is preserved at Git commit `a0567c5` for behavior comparison.

Use Node 24, at least 24.5.0. CI pins 24.22.1. The repository pins pnpm 12.16.1 through `packageManager`.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

The scheduler screen selects a business device or creates an account-free verification device. Chrome tasks open isolated local verification pages for three seconds, with a maximum of two executing devices and four reserved task pages. Install Google Chrome first. In Settings, choose a fresh Chrome launch or an explicit local debugging endpoint to borrow. Leave the executable path empty to detect an installed Chrome, or provide its full path. The application never opens your default browser profile. Page demand and nonsecret execution settings are frozen when a task is accepted. Cancellation acknowledges a durable intention; the screen shows completion only after cleanup. The other routes manage business data.

Development data is stored in `artifacts/dev-data`. Set `BROWSER2D_DATA_DIR` to an independent directory to isolate `data.db`. P3 uses this one database for business data and scheduling. An old P1 `synthetic.sqlite3` is left untouched and is no longer opened or imported as business history. Closing the window stops acceptance and active work, cleans owned resources, and exits on every OS.

A packaged application without that override retains the legacy business path `~/kys/data.db`. Before upgrading a recognized legacy database it requires confirmation that the old application is closed and then acquires SQLite exclusive access. It creates a verified backup before migrating. Do not launch a production package against your real data merely to run tests.

`pnpm dev:ui` previews the interface and explicitly reports work/business operations unavailable. `pnpm dev:worker` starts the Electron worker host without a window. Source and app build-config changes trigger a coordinated rebuild and shutdown before replacement. A failed build keeps the current worker; a failed shutdown prevents replacement. After changing dependency manifests, the lockfile, package-manager settings or the Node version, stop development, install dependencies and restart it.

`pnpm dev -- --inspect-ui` enables loopback renderer debugging for development. In this mode, enter `stop` on stdin to request coordinated shutdown. The Electron tests use this mode to exercise the actual source-rebuild coordinator on all supported hosts.

Owned Chrome profiles live beside the business database under `chrome-sessions/`. Their directories are removed after verified browser exit. Borrowed Chrome stays open; only the task context is disposed. The old file driver remains available for explicit regression tests with `BROWSER2D_EXECUTION=controlled` and isolated `BROWSER2D_DATA_DIR`; its resources live under `controlled-resources/`. Unresolved acquisition or cleanup continues to reserve capacity and blocks reuse of that device. Cleanup is attempted at most three times per worker lifetime; correct the underlying problem and restart to reconcile again. Recovery marks all previous nonterminal tasks interrupted and never automatically executes them again. An ambiguous launch or lost context creation response remains blocked even if a later observation looks empty. Recovery never guesses ownership or kills a PID read from disk.

Per-launch records under `worker-owners/` fence process replacement. A previous PID that is live or cannot be checked blocks takeover; a record never authorizes killing an unrelated process. PID reuse can therefore cause conservative refusal. Normal close allows ten seconds for cooperation and five seconds for forced termination and confirmed exit. Forced or uncertain termination is not reported as clean shutdown.

```sh
pnpm check
pnpm test
pnpm test:storage
pnpm test:credentials
pnpm test:electron
pnpm build
```

`test` runs component tests. `test:storage` uses installed Chrome, real SQLite databases and an independent resource service, including migration, WAL backup, commands, capacity, late acquisition and cleanup fixtures. `test:credentials` checks preserved legacy encryption, Chrome settings validation and concurrent process-ownership claims. `test:electron` covers actual UI/IPC calls, CRUD, OS credentials, host/worker death, stalled driver phases, resource recovery and the real development restart coordinator. Set `BROWSER2D_CHROME_EXECUTABLE` to override the Chrome binary used by tests and package verification. CI provisions Chrome for Testing on each native runner. On Linux the legacy credential integration tests require an unlocked secret service; CI starts a disposable GNOME keyring under a private D-Bus session. `scripts/linux-secret-session.sh` is for that disposable test environment, not a replacement for your desktop keyring.

better-sqlite3 13 ships Node-API platform binaries. Tests validate the driver in Node and Electron. Packaging skips native rebuild and checks the pinned driver's prebuild policy before producing artifacts. A driver upgrade requires an explicit native-verification update.

Packaging runs in a disposable workspace and refuses a target that does not match the host OS and architecture. It never uploads artifacts or uses production signing credentials in P4.

```sh
pnpm package -- --target=mac-x64
pnpm dist -- --target=mac-x64
pnpm verify:package -- --target=mac-x64
```

Other targets are `mac-arm64`, `win-x64` and `linux-x64`. `package` creates a runnable app directory. `dist` also creates unsigned technical-validation distribution formats. `verify:package` physically copies the runnable application outside the checkout and starts it twice with production fuses. It verifies durable command replay/query, queue capacity, active/queued cancellation, business persistence, resource absence and worker exit. Its historical `--verify-p1` mode accepts only a dedicated temporary fixture directory. Installer UI, signing, notarization and production update acceptance belong to P6.

The native CI matrix in `.github/workflows/p1.yml` uses Windows, Intel macOS, Apple Silicon macOS and Ubuntu runners. A configured workflow is not proof of a passing target. Actual acceptance results are recorded separately.

The [P0/P1 acceptance record](docs/implementation/p0-p1-acceptance.md) links the successful native matrix and records the verified scope and remaining production-release work.

The [P2 acceptance record](docs/implementation/p2-acceptance.md) records the business migration, credential, native-platform and final-package checks, with the exact validated revisions and remaining phase boundaries.

The [P3 design](docs/implementation/p3-design.md) explains command receipts, reservations, resource recovery and process ownership. The [P3 acceptance record](docs/implementation/p3-acceptance.md) records the implemented scope and verification evidence.

Read [the approved plan](docs/monorepo-refactor-plan.md) and [P0 source baseline](docs/implementation/p0-baseline.md) for scope, data ownership and later migration stages. `packages/contracts` provides the only shared runtime contract. `internal` contains engineering tools. Desktop depends on the worker's compiled executable package; it never imports worker business code or opens the database.

[P2 implementation decisions](docs/implementation/p2-design.md) describe migration and credential ownership. Persistent credentials use OS encryption in `credentials.enc` under userData. Chrome settings no longer offer API-key storage. Existing encrypted references are preserved and do not gate Chrome startup. Legacy plaintext migration still requires working persistent encryption before removing the old plaintext value. Recovery backups deliberately preserve original data and may contain the old plaintext key. They are not automatically restored over a newer database.

The [P4 design](docs/implementation/p4-design.md) records direct Chrome ownership, isolated contexts, recovery boundaries and the removal of active AdsPower configuration. The [P4 acceptance record](docs/implementation/p4-acceptance.md) separates passed checks from the unresolved Windows/Linux packaged-run failures. Remote reruns are deferred at the user's request after GitHub reported a billing/spending-limit block. P5 is not included.
