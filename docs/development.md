# Develop Browser 2D

Install Node 24 and the pinned pnpm version from `package.json`. CI uses `.node-version`. Install Google Chrome for browser tests. Run commands from the repository root.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

The desktop opens with an isolated database in `artifacts/dev-data`. Closing its window cancels work, cleans owned browser resources and exits the worker. To use another disposable database, set `BROWSER2D_DATA_DIR` to an absolute directory before starting development. Do not point test commands at `~/kys` or a personal Chrome profile.

## Choose an entry point

- `pnpm dev` runs UI, Electron main/preload and the worker together.
- `pnpm dev:ui` previews the UI in a browser. The banner identifies preview mode. Business operations and task execution are unavailable.
- `pnpm dev:worker` runs the same Electron worker host without a window. It is not an independent background service.
- `pnpm dev -- --inspect-ui` enables loopback renderer debugging. Enter `stop` on stdin for coordinated shutdown. The VS Code desktop launch configuration uses this command.

## Change source

Vue templates and styles use Vite HMR and keep the same worker alive. Main, preload, contracts, worker, migrations, app build configuration and shared TypeScript presets trigger a build followed by coordinated restart. A successful restart reloads the renderer preset and recreates the Vite server after the old application exits, so changed plugins and defines reach the live UI. A build or preset-load failure leaves the running app available. A shutdown failure prevents a replacement process from starting.

After changing dependency manifests, the lockfile, pnpm configuration or the Node version, stop development, install dependencies and restart. The coordinator does not update dependencies while the application is running.

The renderer imports only `@browser-2d/contracts/public`. Main validates the calling frame and forwards named business methods. Worker owns the database and Chrome sessions. `internal` contains build, lint, TypeScript and test configuration; production code does not import it. Run `pnpm check:boundaries` to verify these rules and reject retired root entry points.

## Verify a change

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

Component tests use public DTOs. Storage tests use temporary SQLite databases and real Chrome. Electron tests build first and drive the real preload, worker and UI. Development tests temporarily edit source files and restore them in `finally`; do not run a second watcher or edit those files during the test. Playwright reports and traces are written under `artifacts/`.

The Electron suite also starts the independent UI preview and windowless worker entrypoints. It checks unavailable preview operations, zero worker-host windows, clean process exit and database retention across two worker starts.

On Linux, run Electron tests inside a desktop session with a working secret service. CI uses a disposable D-Bus session, GNOME keyring and Xvfb. `scripts/linux-secret-session.sh` only configures that disposable test session.

Set `BROWSER2D_CHROME_EXECUTABLE` to use a specific Chrome binary in tests. Runtime browser settings remain separate. The application opens neutral local verification pages. It does not consume materials or execute external purchases.

## Inspect a failure

A task acceptance receipt does not mean execution finished. Inspect its final state and unresolved resources. Unresolved cleanup retains capacity and blocks reuse of that device. Restarting reconciles owned resources and marks unfinished runs interrupted; it does not replay work.

On POSIX, owned Chrome runs in a private process group. Cleanup waits for group disappearance before deleting its profile, including after the browser leader exits. Unknown final observations keep waiting within the existing deadline; they never count as empty. Windows uses a separately tagged child-exit contract. Historical unfinished browser rows without the required evidence remain visibly uncertain. Restarting does not invent proof or signal stored identifiers.

A settings revision conflict means another save occurred. Reload settings, compare the values and save again. An uncertain task command retains its ID so querying or retrying cannot create a second task.

For packaging and release gates, read [Release engineering](release.md). Preview packages and signed release candidates have different acceptance requirements.
