# Profile removal postcondition investigation

Goal: make native Chrome cleanup evidence reliable before declaring the engineering audit complete. Product remains unchanged.

## Evidence

- Native diagnostic run 41198251677 at source 0f4c8f5 passed its full 73-test sequence, then failed target probe 26. The journal said released while the sampled root contained an empty operation directory. Artifact `/tmp/browser-2d-audit-intel-probe-evidence/chrome-profile-d6131791-53e5-4911-a884-197486a5510d.json`.
- That artifact lacks inode/birthtime and does not sample removal completion. Its empty process filter occurs after the failure, and misses processes whose arguments omit the profile. It cannot prove either recreation or a fulfilled rm with a surviving directory.
- Node 24.22.1's actual embedded `internal/fs/promises` delegates rm to `internal/fs/rimraf`. Captured actual source in `.audit/node-24.22.1-rimraf.js`. It waits for callback completion, suppresses ENOENT, and recursively waits for all children before removing the parent. No application failure mechanism is proved by this source read.
- Isolated `pnpm install --frozen-lockfile` completed. No symlink to the main checkout's dependency tree.
- Diagnostic smoke and 40 bounded local target probes used native x86_64, Node 24.22.1, CfT 156.0.8078.80. All passed. Forty-two trace files including smoke tests each show synchronous ENOENT immediately after successful rm. No sampled CDP-observed process remained alive after the browser-exit observation. These are observations of successful runs, not evidence of absence of the original defect.
- Logs and ordered diagnostic events are under `/tmp/browser-2d-profile-postcondition-traces/`.

## Diagnostic delta

`/tmp/browser-2d-profile-postcondition-diagnostics.patch` only changes test/diagnostic tooling. It records actual rimraf syscall callback results; synchronous before/after root inode, birthtime, ctime and entries; known Chrome process IDs and initial identity lines; and the exact assertion sample. Diagnostic events are buffered until the assertion sample to avoid I/O on every syscall. The added pre-close CDP/ps and per-call logging may perturb the race.

The CI-only shell script runs bounded fs_usage on the disposable runner, retains only controlled browser-2d-closed-recovery path lines and their native process name and thread-ID attribution, and records startup/availability/exit diagnostics. It does not run on this personal machine.

Worker typecheck, target lint, bash syntax, diff whitespace and the instrumented real Chrome smoke passed.

## Next decision

Compare failing trace root inode before rm, final rmdir result and immediate postcondition, then inspect native mkdir/rmdir writer identity. A new inode after successful rmdir proves recreation. A surviving same inode with rm fulfilled directs attention to Node/OS behavior. A directory present only after the assertion sample must be treated as a distinct observation, not proof of the earlier state.

Do not add delays, retries or a product postcondition check until the first wrong boundary decision is proved. If instrumented CI does not reproduce, run the original test with fs_usage only, without the pre-close process inspection or JavaScript syscall wrapping.

## Native instrumented result

Run 41199034153 at diagnostic source 74cf39f passed all 73 storage tests and 40 targeted probes. Download `/tmp/browser-2d-audit-intel-syscall-evidence/profile-probes` contains 40 JavaScript traces and 160,246 fs_usage lines. Grouping by operation UUID found all 40 rm postconditions ENOENT and zero root mkdir calls after successful root rmdir, including teardown. No Chrome filesystem call appeared after the browser-absent event. These successful runs do not explain the original failure.

The fs_usage manual states that wide-mode name suffixes are thread IDs, not process IDs. Native traces identify a process name and thread, but those suffixes must not be joined directly to CDP process IDs. Capture covered 12:00:43 through 12:02:32 with empty stderr and successful exit within its 180-second bound.

Prepared `/tmp/browser-2d-profile-native-only.patch` to allow `BROWSER2D_PROFILE_NATIVE_ONLY=1`, unset NODE_OPTIONS, and record observation-mode.txt. Parent restores the baseline test blob in the disposable diagnostic job. This removes pre-close inspection and JavaScript wrapper overhead for the next native run.

## Reduced observation arms

Corrected passive-original run 41199734949 at 2729ff1 passed the full 73 tests and 40 targets. Original b1 test blob was 3ef31e54c592ef8491f1c36a1ccaca3c7ec78320. Native-only capture contained 39 profile UUIDs, comprising the full-suite target and the first 38 probes. It ended at 12:13:57 before probes 39 and 40 started. There was no root recreation or Chrome filesystem access after successful root removal in those captured profiles. A prior passive setup run 41199559076 failed before tests because shallow checkout could not read b1; it is not runtime evidence.

Focused root-boundary run 41200458284 at 7486050 passed full 73 and 40 targets. Its 41 batches each showed ENOTEMPTY on the initial root rmdir, success on the final root rmdir and ENOENT on immediate rm postcondition. No unusual callback ordering was observed. This arm wraps only root rmdir and rm, without pre-close process inspection, child syscall hooks or fs_usage.

Prepared `/tmp/browser-2d-profile-creation-only.patch` for the next arm. It observes only operation-directory creation before browser spawn and writes the initial inode/birthtime synchronously before launch continues. No removal, shutdown, process-exit or process-sampling hooks remain. It adds inode and nanosecond timestamps only in the existing failure diagnostics of the original b1 test. The intended discriminator is initial versus residual inode/birthtime if the failure recurs. Local exact-version Chrome target and worker typecheck passed.

Creation-only local arm completed 80/80 target passes with 81 initial fingerprints including smoke under `/tmp/browser-2d-profile-creation-only`. No shutdown instrumentation was active. Native run 41201041220 at 277dae0 failed in the separate loaded-contexts test before its 80-probe loop. Its cold-recovery target passed, so that run provides no profile-residue reproduction. Parent retained the separate timeout and removed only the diagnostic warmup suite for the next targeted arm.

Verified identical Chrome-driver source blob a29451e966136da35a34b0af56f2517bdf19d334 at f966, failed-probe source 0f4c8f5, and current b1. The failed probe did not accidentally use an older driver.

Optional `/tmp/browser-2d-profile-creation-nonmatching.patch` returns the original mkdir promise unchanged for nonmatching paths, eliminating even the async adoption hop for unrelated calls. The matched path still records only before Chrome spawn. Real Chrome smoke passed. This is reduced diagnostic perturbation, not an explanation for any failure.

## Recreation discriminator succeeded

Native creation-only run 41201558080 at 1a8111d failed target attempt 80. Controlled path ended in `3e286fbb-dbc8-4f29-b6a0-65e92d587415`.

Initial fingerprint `/tmp/browser-2d-audit-intel-creation-target/profile-probes/created-10088.jsonl` recorded inode `12888456740` and birthtime `1793450284215156257` ns (12:38:04.215156257 UTC). The failure JSON `/tmp/browser-2d-audit-intel-creation-target/chrome-profile-3e286fbb-dbc8-4f29-b6a0-65e92d587415.json` recorded inode `12888456982` and birthtime `1793450285762167339` ns (12:38:05.762167339 UTC), an empty directory of size 64. Failure capture was 12:38:05.762 UTC and journal was released.

The root was replaced with a newly created directory near the assertion. It was not the original inode silently surviving removal. This arm does not observe the actual rm completion timestamp, so the exact ordering within that last millisecond remains unobserved. The writer is still unknown. The worker has only one matching promise-mkdir fingerprint, so a second application fs.promises.mkdir call is excluded; other Node filesystem APIs and external processes are not excluded.

A single immediate absence check would not prevent a later recreator. No production change has been made. Next investigation needs writer attribution for the namespace mutation while retaining low perturbation.

## Native creator identified

Run 41203336758 at 2dff459 passed all 80 target assertions. Namespace tracing nevertheless captured a real late recreation during a passing test. Compact positive evidence is `.audit/profile-recreation-proof.json`; complete source is `/tmp/browser-2d-audit-intel-namespace-evidence/profile-probes/namespace.tsv`, lines 14210-14619 for the relevant root events.

For operation `66690d36-7869-4d28-bd00-7a59373427ee`, Node worker PID 9411 created the initial root. Owned Chrome main PID 9412 had PPID 9411. Both shared PGID 9383. Node's successful root rmdir returned at 1793451575422081767 ns. Chrome Helper PID 9429, already reparented to PID 1 and still in PGID 9383, then successfully recreated the exact root at 1793451575428353496 ns. Node teardown removed that new root at 1793451575430129975 ns. The assertion passed because its sample preceded this late creation; teardown masked the residue.

All 80 profiles have initial-Node mkdir and normal-Chrome subdirectory positive controls. All 80 Node API fingerprints were only the initial promise mkdir; no callback or synchronous Node root recreation was recorded. DTrace reported dynamic-variable drops and null return-action errors, so absence claims would be invalid. The positive successful mkdir entry/return pair is explicit and attributable despite those unrelated trace losses.

The first wrong boundary is treating main-browser process absence as proof that the owned browser process family can no longer write to its profile. Current macOS launch inherits the worker process group, so signaling that existing group would be unsafe. A production fix must establish a dedicated ownership/lifetime witness at launch and wait for it before deleting the profile. No filesystem postcondition check or arbitrary retry can prevent this later recreator. Product is still unchanged in this worktree.
