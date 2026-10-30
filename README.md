# Browser 2D foundation

P0/P1 implements a synthetic desktop workflow through Vue, a sandboxed preload, Electron main, a utility process and SQLite. The original business code remains under `src/` and `electron/` as a migration baseline. The new application never opens `~/kys/data.db` or starts AdsPower.

Use Node 24, at least 24.5.0. CI pins 24.22.1. The repository pins pnpm 12.16.1 through `packageManager`.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

The foundation screen starts timed synthetic tasks, cancels them and displays persisted results. Development data is stored in `artifacts/dev-data`. Set `BROWSER2D_DATA_DIR` to an independent directory to isolate a session. Closing the window stops active tasks and exits on every OS.

`pnpm dev:ui` runs an explicitly labelled in-memory UI preview. `pnpm dev:worker` starts the Electron worker host without a window. Source and app build-config changes trigger a coordinated rebuild and shutdown before replacement. After changing dependency manifests, the lockfile, package-manager settings or the Node version, stop development, install dependencies and restart it.

```sh
pnpm check
pnpm test
pnpm test:storage
pnpm test:electron
pnpm build
```

`test` runs component tests. `test:storage` uses real temporary SQLite databases under host Node. `test:electron` covers the real UI/IPC/utility process, sender rejection, persistence, normal shutdown, crash recovery and unresponsive-worker handling on POSIX. better-sqlite3 13 ships Node-API platform binaries. Tests validate the driver in both runtimes. Packaging skips native rebuild and checks the pinned driver's prebuild policy before producing artifacts. A driver upgrade requires an explicit native-verification update.

Packaging runs in a disposable workspace and refuses a target that does not match the host OS and architecture. It never uploads artifacts or uses signing credentials in P1.

```sh
pnpm package -- --target=mac-x64
pnpm dist -- --target=mac-x64
pnpm verify:package -- --target=mac-x64
```

Other targets are `mac-arm64`, `win-x64` and `linux-x64`. `package` creates a runnable app directory. `dist` also creates unsigned P1 distribution formats. `verify:package` physically copies the runnable application outside the checkout, starts it twice with production fuses and checks synthetic task execution, cancellation, persisted rows and confirmed worker exit. Its `--verify-p1` mode accepts only a dedicated temporary fixture directory. Installer UI, signing, notarization and production update acceptance belong to P6.

The native CI matrix in `.github/workflows/p1.yml` uses Windows, Intel macOS, Apple Silicon macOS and Ubuntu runners. A configured workflow is not proof of a passing target. Actual acceptance results are recorded separately.

The [P0/P1 acceptance record](docs/implementation/p0-p1-acceptance.md) links the successful native matrix and records the verified scope and remaining production-release work.

Read [the approved plan](docs/monorepo-refactor-plan.md) and [P0 source baseline](docs/implementation/p0-baseline.md) for scope, data ownership and later migration stages. `packages/contracts` provides the only shared runtime contract. `internal` contains engineering tools. Desktop depends on the worker's compiled executable package; it never imports worker business code or opens the database.
