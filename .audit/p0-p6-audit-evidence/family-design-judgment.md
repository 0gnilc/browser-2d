# Independent family-lifetime design judgment

The user's goal is to finish the current P0 through P6 engineering audit and fix demonstrated resource-cleanup defects while retaining the agreed formal-release gates. I read A, B and C end to end, the rubric and grounding, the current process and journal modules and cleanup paths, the original plan's lifecycle and acceptance requirements, the current acceptance draft, and the positive orphan-helper evidence. I ran no builds or tests and made no product edits.

Choose C as the base, with the startup ownership rule from A and the native evidence detail from B. The three candidates agree on the core POSIX mechanism. The remaining differences are startup ownership, proof naming, and Windows scope. No candidate is implementation acceptance.

| Rubric criterion | A | B | C |
| --- | --- | --- | --- |
| 1. Prevent deletion/release with a surviving owned writer, including cold recovery and pre-attachment cancellation | 2 | 1 | 2 |
| 2. Preserve ownership safety and existing wait bounds | 2 | 2 | 2 |
| 3. Durable states, legacy JSON, immutable SQL migrations | 2 | 2 | 2 |
| 4. Concrete Windows behavior and verification without false equivalence or disabled normal operation | 2 | 2 | 1 |
| 5. Small process-lifetime boundary without unnecessary supervisors/dependencies | 1 | 1 | 2 |
| 6. Deterministic real-process regression and native evidence before teardown | 2 | 2 | 2 |
| Total | 11 | 10 | 11 |

A's Windows design and regression plan are concrete, but its default common interface commits to a persistent controller, endpoint and receipt protocol before this defect establishes their necessity. B has the same scope cost. B also awaits `launchOwned`, then saves the journal, then retains the live handle. A partial startup failure, cancellation, or journal-save exception can leave the driver without its cleanup capability. The prose does not define who owns that failure path. C retains the handle synchronously and concentrates the change. C loses one Windows point because preserving the old path while making legacy stopped uncertain is not yet a complete versioned transition contract. Resolve that before implementation.

The Laziness Protocol selects C's smaller boundary at the tie. Type System Discipline requires persisted evidence kinds to remain distinct, so the implementation cannot consume a Windows main-exit observation or a legacy stopped row as POSIX group-empty proof.

## Scope verdict

Implement the narrow POSIX group correction now. A Windows Job Object implementation is not required by the evidence or by a platform-neutral reading of the current acceptance cases alone. The reproduced actor is a macOS helper in the inherited POSIX group. The plan requires observing owned resources and reporting uncertain cleanup honestly. It does not mandate a universal OS containment facility, containment of arbitrary escaping descendants, or a new native Windows launcher protocol.

This judgment does not defer Windows engineering testing under the label of formal release. Keep Windows launch, cancellation, cold recovery, borrowed-browser survival, bounded cleanup, and profile-removal regression cases in the current matrix. Run them on the modified source. Their results establish those exercised behaviors. They cannot establish a universal Windows family-drain invariant. The current engineering report must state this distinction, and must not say that all owned process families across all operating systems are now proven empty before release.

The checked Chromium main source classifies the browser process as needing the profile directory and other listed process types as not needing it. This is a useful reason to avoid assuming the observed POSIX actor reproduces identically on Windows. It is not a proof about every profile write, the pinned Chrome binary, every service/crash handler, or future Windows behavior. Source blob observed was `0a8af7cc25f065012bb1f3d59ddd61c15067f7e1`. See [Chromium install_util.cc](https://chromium.googlesource.com/chromium/src/+/main/chrome/install_static/install_util.cc).

If the final acceptance claim is strengthened to require an OS-backed family-empty witness for every Windows cleanup, or an actual Windows writer is observed after the selected main-exit boundary, the narrow patch is insufficient. Implement and verify the Job Object solution then. Do not silently claim that stronger requirement is met, and do not classify a demonstrated Windows defect as a formal-release-only gate. The present read-only review found no such Windows runtime evidence.

## Accepted implementation contract

1. New POSIX launches enter their own session and process group. Only that actual successful spawn can construct its witness. Validate positive safe group identifiers greater than one, and reject the worker's own identity. The existing inherited group is never a witness. Persist the dedicated group before the public spawned checkpoint, CDP attachment, or acquisition return.
2. Retain the child synchronously before any await or durable save that can fail. Graft A's rule here. If successful-spawn notification is asynchronous, the live record owns cleanup throughout that wait. A promise rejection alone is not proof that no process was created. A successful journal write must not be required for the in-memory cleanup capability to survive.
3. A recorded group permits read-only observation only. `kill(-pgid, 0)` is permitted. Only `ESRCH` means empty. Permission errors and other failures mean unknown. No SIGTERM or SIGKILL targets a group, any stored PID, or a recovered numeric identity. Live main termination stays with the retained child. Verified CDP close retains all existing owner-token, exact-profile, browser-hash, PID and process-identity checks.
4. All POSIX cleanup paths require group emptiness before persisting a new stopped proof and before removing the profile. Main exit, absent main PID, absent discovery file, rejected CDP connection, and failed acquisition are insufficient alone. A main-gone spawned or attached record can observe its group without CDP. A still-live browser may be closed only with existing authority. An unavailable main connection must not bypass or erase the witness.
5. Presence at the deadline returns bounded CLEANUP_FAILED and keeps the profile, obligation and capacity. An unobservable group returns OWNERSHIP_UNCERTAIN. Use existing cleanup signals, retry counts and budgets. Reused group IDs can conservatively block recovery; they never confer termination permission.
6. Store a versioned evidence kind, with schemas as the source of types. New POSIX stopped means `posix-group-empty`, or `never-spawned` where positively established. New Windows records must explicitly retain a different `windows-main-exited` or equivalent child-only contract. Do not name that Windows observation family-empty. Normal Windows successful work and its supported retry path must still be able to release after main-exit confirmation and completed profile deletion. Persist the platform/contract discriminator early enough that recovery does not infer the originating platform from the current host.
7. Preserve all legacy JSON parsing. Raw unversioned prepared is cleanable because attempted was written before spawn. Raw legacy attempted, attached and stopped lack the new lifetime witness. For these ambiguous existing rows, keep the cleanup obligation visibly uncertain and do not delete the profile or signal a saved identity. In particular, old stopped was only main exit. Do not trust its phase name or infer its original platform from the host. Existing terminal released records remain historical, with no invented new proof. A verified legacy browser may be asked to close under existing ownership rules, but this does not manufacture a missing family witness or permit profile removal.
8. The attempted-to-spawned crash window stays explicit. A fresh driver seeing attempted without durable witness cannot infer no spawn, replay acquire, guess a group, or delete the profile. It reports uncertainty. A retained local handle may complete cleanup after proving no spawn or family drain. A supervisor is not justified merely to reclaim this accepted uncertainty window.
9. Profile deletion follows durable stopped proof and precedes released, with the existing signal checks. Partial deletion or cancellation retains stopped and the obligation for retry. New Windows child-only stopped and POSIX group-empty stopped must take explicit branches. No generic `.phase === 'stopped'` branch may confer stronger evidence on either legacy or platform-specific data. SQL migrations 001 through 004 remain byte-identical.
10. Borrowed sessions never enter the family observer or termination paths. Keep context verification and unrelated-tab survival unchanged.

The Windows branch in item 6 and the legacy rule in item 7 are intentional. Existing ambiguous records may remain blocked, while newly launched ordinary Windows work stays available. Do not keep writing unversioned Windows stopped rows and then make every retry reject them as legacy.

## Grafts and rejections

Graft A's immediate retained launch capability and successful-spawn distinction. Its explicit rule that startup rejection cannot prove never-started is necessary for pre-attachment cleanup. Keep C's existing OwnedChild shape as far as possible instead of adding A's universal launch wrapper.

Graft B's source-bound native evidence ledger. Record source commit, runtime, Chrome version, operation ID, worker/main/helper PID and PGID, helper handshakes, main absence, blocked cleanup, helper write, helper exit, group absence and pre-teardown namespace state. Capture root entries and journal state on failure before teardown. Positive events support attribution. Trace drops prohibit absence claims.

Reject B's async launch/save/store ordering. Reject A/B's persistent Windows controller as mandatory scope for this POSIX defect. Retain their Windows Job discussion only as the requirement for a future stronger cross-platform containment claim. Reject delayed repeated rm, post-rm stat as proof of no future writer, process-tree snapshots, taskkill ancestry recovery, inherited-group signaling, and cold group termination.

## Required work before current engineering acceptance

Implement the selected contract, including the explicit Windows/legacy distinction. The design sketches are not enough.

Run the real Chrome launcher fixture with independently gated helper write and exit commands outside the managed profile. The launcher must exec Chrome so existing PID checks remain real. Require main and helper to share the new group and the worker to be outside it. Hold the helper after main exit. A fresh driver and reopened database must retain the profile and capacity, including a queued task blocked by that capacity. Abort one cleanup attempt and check bounded failure. Command the helper's late write and positively acknowledge it. Release the helper, observe group absence, then require successful cleanup and absent managed namespace before teardown.

Exercise pre-attachment interruption after the spawned journal, lost acquisition result, attempted-without-witness uncertainty, raw legacy stopped/attached/attempted rows, prepared cleanup, partial-removal retry, ordinary owned completion/cancellation and borrowed-tab survival. Add a journal-save failure case that demonstrates the retained child remains available for cleanup. These are behavior assertions, not tests that only inspect new fields.

Verify dedicated-group behavior and profile writers on the affected Intel macOS build and the other supported POSIX targets. The deterministic fixture proves the challenged ordering. Native Chrome evidence must show the actual relevant writer stays in the chosen group. A relevant writer escaping that group invalidates this solution. No finite observation proves arbitrary executable containment.

Run the appropriate process/journal/Chrome tests, type/boundary checks and the normal four-target engineering matrix on the final source. Preserve Windows real-Chrome tests and their original assertions. Report actual results separately from the scoped lifetime proof. Rebuild and revalidate delivered artifacts where required by the audit. Do not reuse b1 results as acceptance of changed source.

The scope verdict is approved for synthesis. Product correctness, Windows regression status, POSIX namespace validation, and final P0 through P6 engineering acceptance remain unverified by this review.
