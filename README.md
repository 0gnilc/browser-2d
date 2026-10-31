# Browser 2D desktop

P0/P1 provides the desktop foundation. P2 adds device, material, history and settings operations through the sandboxed preload and worker-owned SQLite. The foundation screen still runs synthetic tasks. Real scheduling and AdsPower integration remain P3/P4 work. The retired `src/` and `electron/` implementation is preserved at Git commit `a0567c5` for behavior comparison.

Use Node 24, at least 24.5.0. CI pins 24.22.1. The repository pins pnpm 12.16.1 through `packageManager`.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

The foundation screen starts timed synthetic tasks, cancels them and displays persisted results. The other routes manage business data. Development data is stored in `artifacts/dev-data`. Set `BROWSER2D_DATA_DIR` to an independent directory to isolate both `synthetic.sqlite3` and business `data.db`. Closing the window stops active tasks and exits on every OS.

A packaged application without that override retains the legacy business path `~/kys/data.db`. Before upgrading a recognized legacy database it requires confirmation that the old application is closed and then acquires SQLite exclusive access. It creates a verified backup before migrating. Do not launch a production package against your real data merely to run tests.

`pnpm dev:ui` runs an explicitly labelled in-memory foundation preview; business operations report unavailable. `pnpm dev:worker` starts the Electron worker host without a window. Source and app build-config changes trigger a coordinated rebuild and shutdown before replacement. After changing dependency manifests, the lockfile, package-manager settings or the Node version, stop development, install dependencies and restart it.

```sh
pnpm check
pnpm test
pnpm test:storage
pnpm test:credentials
pnpm test:electron
pnpm build
```

`test` runs component tests. `test:storage` uses real temporary SQLite databases under host Node, including legacy migration and WAL backup fixtures. `test:credentials` injects storage failures into the credential vault. `test:electron` covers actual UI/IPC/utility process calls, CRUD restart persistence, OS-encrypted credentials, sender rejection and worker shutdown/failure. On Linux the credential integration tests require an unlocked secret service; CI starts a disposable GNOME keyring under a private D-Bus session. `scripts/linux-secret-session.sh` is for that disposable test environment, not a replacement for your desktop keyring.

better-sqlite3 13 ships Node-API platform binaries. Tests validate the driver in Node and Electron. Packaging skips native rebuild and checks the pinned driver's prebuild policy before producing artifacts. A driver upgrade requires an explicit native-verification update.

Packaging runs in a disposable workspace and refuses a target that does not match the host OS and architecture. It never uploads artifacts or uses production signing credentials in P2.

```sh
pnpm package -- --target=mac-x64
pnpm dist -- --target=mac-x64
pnpm verify:package -- --target=mac-x64
```

Other targets are `mac-arm64`, `win-x64` and `linux-x64`. `package` creates a runnable app directory. `dist` also creates unsigned technical-validation distribution formats. `verify:package` physically copies the runnable application outside the checkout and starts it twice with production fuses. Its `--verify-p1` mode accepts only a dedicated temporary fixture directory. Installer UI, signing, notarization and production update acceptance belong to P6.

The native CI matrix in `.github/workflows/p1.yml` uses Windows, Intel macOS, Apple Silicon macOS and Ubuntu runners. A configured workflow is not proof of a passing target. Actual acceptance results are recorded separately.

The [P0/P1 acceptance record](docs/implementation/p0-p1-acceptance.md) links the successful native matrix and records the verified scope and remaining production-release work.

The [P2 acceptance record](docs/implementation/p2-acceptance.md) records the business migration, credential, native-platform and final-package checks, with the exact validated revisions and remaining phase boundaries.

Read [the approved plan](docs/monorepo-refactor-plan.md) and [P0 source baseline](docs/implementation/p0-baseline.md) for scope, data ownership and later migration stages. `packages/contracts` provides the only shared runtime contract. `internal` contains engineering tools. Desktop depends on the worker's compiled executable package; it never imports worker business code or opens the database.

[P2 implementation decisions](docs/implementation/p2-design.md) describe migration and credential ownership. Persistent credentials use OS encryption in `credentials.enc` under userData. A session-only replacement expires on restart and never restores a previous persistent key. Legacy plaintext migration requires working persistent encryption; session mode cannot bypass that requirement. Recovery backups deliberately preserve original data and may contain the old plaintext key. They are not automatically restored over a newer database.
