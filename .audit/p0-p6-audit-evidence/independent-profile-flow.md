# Independent Chrome profile flow exploration

The goal is to complete the P0 through P6 engineering acceptance audit, fix proven defects, and retain formal release gates. This slice independently checked whether the intermittent cold Chrome recovery residue can be explained by application control flow, test control flow, or module semantics before proposing another fix.

## Scope and method

Read-only repository investigation at `b1b592fbacd33f20fc2bf42a7583280b2b6f184d`. The worktree was clean before and after the reads. Driver blob was `a29451e966136da35a34b0af56f2517bdf19d334`. No product edits, builds, Chrome launches, Electron runs, or test runs were performed. Only this report was written outside the checkout.

Read the pstack poteto-mode, how, TypeScript practices, and type-system-discipline skills. This is the parent investigation's independent source-flow exploration. No further agents were spawned.

Inspected the exact application driver, journal, process helpers, connection helpers, repository mutations, full target test, worker Vitest configuration, installed Vitest 5.0.5 runtime, installed Puppeteer 25.16.0 source, probe branch workflows at `0f4c8f5` and `1a8111d`, and the retained failure JSON at `/tmp/browser-2d-audit-intel-probe-evidence/chrome-profile-d6131791-53e5-4911-a884-197486a5510d.json`.

Also executed only the already downloaded Node `24.22.1` x64 binary to read its embedded `internal/fs/promises` and `internal/fs/rimraf` source. The main shell's default Node is `24.5.0`, so conclusions about the target runtime use the downloaded exact binary instead.

## Proven control flow

1. The target test manually admits one run and calls `driver.acquire`. No `createWorkService` is constructed in that test. Acquisition prepares the journal, creates the operation profile, spawns Chrome, verifies its command line and browser PID, and synchronously saves the `attached` journal before returning. See `apps/worker/tests/chrome.test.ts:644` and `apps/worker/src/browser/chrome-driver.ts:93`.
2. The observer attaches to the existing DevTools endpoint and obtains the browser PID from CDP. Puppeteer's connect-only close callback sends `Browser.close`; its subsequent disconnect does not delete a profile or launch a browser. The test then polls `process.kill(pid, 0)` until ESRCH.
3. `database.work.recover()` updates SQL run/resource state only. It does not call driver cleanup, spawn a browser, or create directories. See `apps/worker/src/work/repository.ts:264`.
4. `recovered` is a fresh `createChromeDriver` instance. Its `children` and `attached` maps are empty. Its journal is the same SQL-backed journal object. `cleanupOwned` sees `attached` plus absent PID, then returns `released(intent, 'launch', signal)` at `chrome-driver.ts:209`.
5. `released` has no attached resource to disconnect in the fresh instance. It synchronously advances `attached` to `stopped`, awaits `abortable(rm(directory(intent), { recursive: true, force: true }), signal)`, checks abort again, and only then synchronously saves `released`. See `chrome-driver.ts:179`.
6. `abortable` forwards pending fulfillment or rejection. It can reject early on abort, but it has no path to fulfill before its pending rm fulfills. An abort is caught and returns `blocked`; it cannot produce the observed `resolved` plus `released` pair.
7. The test awaits cleanup, then calls SQL-only `work.resolved`, reads SQL resources, and awaits `readdir(root)`. No later mkdir is present in that span. The original driver's registered cleanup is an `afterEach` callback and cannot run before this assertion. Operation IDs, root, and the captured intent are not mutated by these repository calls.

Therefore, under the inspected source and unmodified Node filesystem implementation, the observed `released` journal entails a fulfilled rm for the exact operation path. The application has no identified source-level branch that journals `released` while deliberately skipping that rm in this test. The existing `state.phase === 'released'` fast path is real but cannot explain the first fresh cleanup here because acquisition saved `attached` and recovery does not alter the Chrome journal.

## Module and test semantics

`chrome.test.ts` does not mock `node:fs/promises`. It does contain a separate `Browser.prototype.waitForTarget` spy in the cancel-before-target test, restored in a finally block. That test is skipped by the target-only probe selection and does not patch filesystem functions in any case.

The added `chrome-profile-cleanup.test.ts` does mock `rm`, but worker Vitest config does not disable isolation. Installed Vitest defaults set `isolate: true`. Its worker runtime resets the module mocker and evaluated modules before each file and resets the mocker after each file. More decisively, the failing native probe invokes a fresh Vitest process with only `tests/chrome.test.ts` and the target test name. The separate filesystem-mock test file is not loaded. This excludes cross-file rm mock leakage as the explanation for that native probe.

The observer uses Puppeteer connect, not launch. `ChromeLauncher.defaultArgs` constructs a list of command-line strings and does not itself create a profile. Puppeteer's launch-specific temporary profile cleanup therefore cannot be a competing cleanup actor for this observer.

## Node rm semantics

Exact Node 24.22.1 `fs.promises.rm` validates options and returns the `rimrafPromises` promise. `rimrafPromises` fulfills only when its callback reports no error. For a stable directory, rimraf first attempts rmdir, enumerates children after ENOTEMPTY, counts every child's completed callback, and performs the parent's final rmdir only when all child callbacks complete. No early-success callback path was found for a stable existing directory.

The implementation tolerates ENOENT. It also has an ENOTDIR path that can report the original error, which can be null, after a directory changes type between lstat and rmdir. Those paths require concurrent namespace mutation or incorrect OS results and do not independently explain a stable residual directory. They should not be promoted into a product fix without observing the actual event sequence.

`/tmp/browser-2d-node-rimraf-source.txt` is not byte-identical to the exact downloaded runtime. Its only normalized difference is the target runtime's Windows-specific exclusion of EPERM from the nonempty error set. The Darwin branch is the same algorithm. This source-fidelity detail does not supply a Darwin failure cause.

## What the retained failure proves and does not prove

The retained JSON proves the first readdir returned the exact operation name, the SQL journal was `released`, and a later recursive listing plus lstat found one empty-looking directory with mode 0700 and size 64. It also records no process matching the profile path or browser PID when its later ps snapshot ran.

It does not prove that the residual directory is the original inode. It records neither inode nor birthtime. Directory mtime records child-entry changes, not directory creation. The 1 ms difference between capturedAt and mtime is insufficient to establish a precise creation or removal ordering.

It does not prove that no helper existed while rm ran. The ps snapshot is after the first readdir. Its filter only matches a full profile pathname or the browser PID. A helper can exit before that snapshot, omit that pathname from its command line, or use another namespace alias. This is a limitation of the evidence, not proof that a helper caused the failure.

It does not independently prove the exact syscall outcomes within rm. A fulfilled JavaScript promise plus residual entry admits at least an intervening pathname recreation, an unexpected rm binding/mutation, or a lower-level filesystem/runtime anomaly. Source inspection rules out several application and test causes but does not choose among those remaining explanations.

## Decisive next discriminator

The already running creation-only witness is well chosen. Compare its pre-spawn inode plus birthtime to the residual inode plus birthtime on an actual failure. A different inode or a new birthtime proves pathname recreation after the original creation. The identity of the recreating actor remains a separate question. Matching inode and birthtime would instead make an original-directory survivor plausible and justify examining actual rm syscall results or binding mutation rather than adding process-wait delays.

If that discriminator produces no failure, its passing count is evidence only for that observation mode. It should not close an independently reproduced uninstrumented failure. If it captures a failure but the identity evidence is ambiguous, the next narrow probe should record callback-level lstat/rmdir/unlink outcomes for this single operation directory and the exact resolved rm binding, preferably to an in-memory buffer flushed only after failure. Additional synchronous per-syscall I/O would materially change timing.

No speculative fix is recommended from this source-only slice. Do not weaken the empty-root assertion. It checks the intended privacy and ownership cleanup outcome, and SQL resources disappearing is not a substitute for profile removal.
