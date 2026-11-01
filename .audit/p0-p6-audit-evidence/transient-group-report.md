# Final owned-lifetime wait correction

The goal is to preserve profile ownership and page capacity during an unknown final group observation, and allow an already authorized shutdown to complete when the group later becomes empty.

Branch `codex/audit-transient-group-wait` is based on `670a70e`. The regression commit is `8253681`. The fix commit is `adde4dd`. The tracked worktree is clean.

The production diff has three insertions and four deletions in two files. `awaitOwnedLifetime` waits on both present and unknown observations using the existing 25 ms interval and caller AbortSignal. It returns stopped proof only for empty, which the OS boundary recognizes only from ESRCH. Its return type is now `Promise<StoppedProof>`, and the driver consumes that proof directly. The initial `cleanupOwned` unknown guard remains unchanged. No timeout, cleanup attempt, signaling authority, Windows Job controller, or production logging changed.

This corrects the meaning of the accepted design's final drain. Unknown still supplies no proof and no termination authority. Re-observation occurs inside the existing cleanup invocation and deadline. Persistent uncertainty aborts and preserves ownership. The initial guard remains a separate decision before termination authority. The diagnostic at `/tmp/browser-2d-arm-cleanup-41212860572.log` lines 681–715 shows the specific final-probe EPERM and immediate uncertainty failure after main exit. The later ESRCH observation establishes subsequent emptiness, not a measured duration of the EPERM state.

The process regressions use metadata minted by actual spawn. EPERM followed by ESRCH returns proof only after the second observation. Persistent EPERM responds to explicit caller abort without proof. The Chrome regression uses the existing inherited helper with a socket handshake. It permits the initial group probe, denies final probes, and verifies main exit, surviving helper, retained profile and journal, retained four-page capacity, queued work, and a helper profile write. An aborted direct cleanup retains ownership. A subsequent real WorkService cleanup continues through unknown observations and resolves in exactly one cleanup call after the helper exits and the actual group probe becomes empty. It asserts the empty namespace before fixture teardown. There are no new arbitrary sleeps.

Verification ran on darwin x64 with Node v24.5.0 after an isolated `pnpm install --frozen-lockfile`. No root node_modules symlink was used.

- `transient-final-red.log` records the final regression tree against the original production implementation. Three tests fail and eight pass. The real-driver assertion reports expected waiting and received settled. The OS-boundary cases report undefined instead of proof or abort rejection.
- `transient-empty-preservation-control.log` records the temporary EPERM-as-empty mutation. The helper remains alive and the journal assertion reports expected attached and received released. The mutation was restored before final verification.
- `transient-final-worker.log` records all 100 worker tests passing across 11 files on the final code.
- `transient-green-typecheck.log` and `transient-green-lint.log` record full workspace typecheck and lint passing. After the final test assertions changed, `transient-final-typecheck.log` and `transient-final-lint.log` record worker typecheck and changed-file lint passing again.
- `transient-green-boundaries.log` records the source-boundary check and all 36 boundary tests passing.
- `transient-final-format.log` records formatting checks for all four changed files passing. `git diff --check` passed.

The local result is not a new ARM fused-package acceptance result. No cross-platform artifact, formal release, or independent review verdict is claimed. The parent owns those remaining gates.

Model the Domain kept the existing present, empty, and unknown observation model. Type System Discipline removed the impossible resolved-undefined outcome from the wait signature. Prove It Works required both the old-behavior failure and the unsafe-empty mutation failure before accepting the passing real-helper result.
