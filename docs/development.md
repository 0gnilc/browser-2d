# Develop and verify Browser 2D

## Run the application

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Use `pnpm dev:backend` to run DataService without a window. Use `pnpm dev:ui` for the standalone interface, whose desktop operations report unavailable. Set `BROWSER2D_DATA_DIR` to an isolated userData root when you need a separate database and credential file.

The root build compiles both backend roles, then Electron Main, preload, and the renderer once. The UI workspace build is a separate validation command.

```sh
pnpm build
pnpm --filter @browser-2d/ui build
```

## Change running code

Renderer changes use Vite HMR and preserve the DataService and open database. Backend, Main, preload, contract, migration, and shared preset changes trigger a coordinated restart. The coordinator builds first, preserves the running application when the build fails, then asks the old app to shut down before launching its replacement. An unclean exit blocks replacement.

Do not run source-mutating development tests while a watcher, another source build, or package copy is active. `pnpm test:electron` runs Playwright with one worker. Its development tests restore every changed source file and stop their coordinator before returning.

## Run checks

```sh
pnpm check
pnpm verify
```

`check` runs formatting, lint, all workspace and Electron-test type checks, source boundaries, negative boundary fixtures, and the script path map check. `verify` adds workflow contracts, domain and Vue tests, application storage, credentials, updates, release tooling, platform and process isolation, and real Electron UI and development behavior.

Use these commands for focused checks.

```sh
pnpm test:storage
pnpm test:credentials
pnpm test:updates
pnpm test:platform
pnpm test:process
pnpm test:electron
```

`test:process` builds and runs the real Electron utility processes. It checks cancellation, late starts, crashes, uncertain ownership, replay protection, DataService loss, recovery, and a production BrowserWorker connected to local test Chrome. `BROWSER2D_CHROME_EXECUTABLE` selects an installed test Chrome binary. CI provisions this binary explicitly.

Electron UI checks use temporary userData directories. They cover actual Browser and Card forms, text and UTF-8 TXT import, raw fields, draft protection, settings persistence, manual updates, and foreign-frame rejection. The fixed `--verify-workbench` workflow uses the same window, preload, DataService, coordinator, and real utility-process fixture to check queued work, immediate stop, committed Card values, and input locks. It cannot contact the user's AdsPower instance.

`pnpm test:adspower` is a separate, explicitly provisioned real-platform acceptance command. Ordinary CI never uses port 50325 or a real AdsPower key. Keep real-platform credentials and profiles under the root acceptance owner's control.

## Script ownership

`scripts/dev` owns development coordinators. `scripts/checks` owns graph and artifact checks. `scripts/testing` owns test orchestration and native helpers. `scripts/packaging` owns preview artifacts and installation checks. `scripts/release` owns production candidate verification and staging. `scripts/process.mjs` is the shared command runner.

`scripts/checks/script-paths.json` is the exact migration map. `node scripts/checks/script-paths.mjs` rejects retired script paths. Its `--apply` option applies the recorded move to an unmigrated checkout and updates consumers.

## Retired coverage

The removed storage and Chrome-launch suites exercised the retired schema, migration import, profile launch/connect logic, and old UI API. Their current equivalents are application storage tests, public contract tests, AdsPower adapter tests, ownership tests, the process acceptance workflow, and Browser/Card Electron tests. Credentials, updater transport, lifecycle, source boundaries, packaging provenance, and native installation checks remain separate gates.
