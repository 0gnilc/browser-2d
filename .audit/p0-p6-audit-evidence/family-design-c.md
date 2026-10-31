# Owned Chrome cleanup design C

This design addresses the proven POSIX defect at b1b592fbacd33f20fc2bf42a7583280b2b6f184d. An owned Chrome helper can outlive the main browser and recreate its profile after removal. The caller must retain its reservation until the owned process group has no members, then remove the profile, then release the reservation. The artifact is design only. It changes no project source, tests, SQL migrations, or issues.

## Caller usage

The work service keeps its existing interface and policy. It still calls `acquire(intent, signal)`, optionally calls `execute(resource, run, signal)`, and calls `cleanup(intent, cleanupSignal)` for every obligation. Cleanup has exactly two public outcomes. `resolved` means the driver has completed the applicable cleanup contract. `blocked` retains the reservation. The service does not coordinate process details.

Within `chrome-driver.ts`, the intended POSIX call sites are:

```ts
// Acquisition, after journal write-ahead and before the spawned checkpoint.
const child = spawnOwned(executable, args);
children.set(intent.operationId, child);
const family = launchedFamily(child);
if (family.kind === 'posix-group') {
	journal.save(intent.operationId, {
		version: 2,
		mode: 'launch',
		phase: 'spawned',
		family,
	});
}
await checkpoint?.('spawned', intent.operationId, signal);

// Normal cleanup. CDP ownership verification and Browser.close stay here.
// A retained child handle remains the sole authority for direct termination.
await stopOrCloseVerifiedBrowser(...);
const observation = await waitForFamilyEmpty(family, signal);
if (observation.kind !== 'empty') return blockedFor(observation);
journal.save(intent.operationId, stoppedWith(observation.proof));
return removeProfileThenRelease(intent, signal);

// Fresh-driver recovery. This has no process termination authority.
const observation = await waitForFamilyEmpty(state.family, signal);
if (observation.kind !== 'empty') return blockedFor(observation);
journal.save(intent.operationId, stoppedWith(observation.proof));
return removeProfileThenRelease(intent, signal);
```

These are interface sketches, not executable implementations. The acquisition journal failure after spawning must leave `children` populated. Cleanup can still stop the retained child and observe the family. A thrown acquisition result never erases that obligation.

The final recovery call site is used directly when the main PID has already disappeared. If the main browser is still alive, cleanup first connects to CDP and verifies the existing owner marker, exact profile, browser hash, PID, and process identity before requesting `Browser.close`. Missing CDP discovery is never final proof of absence.

## Grounded ownership and flow

`work/service.ts` owns reservations, deadlines, finite cleanup attempts, and the transition from unresolved obligation to released capacity. Its cleanup timer can outlive a returned failure without granting release. `browser/journal.ts` owns durable browser acquisition and cleanup facts inside the existing `chrome_operations.state` JSON. `browser/chrome-driver.ts` owns Chrome identity checks, isolated contexts, and profile deletion. `browser/process.ts` owns child creation and OS process observation.

Today `spawnOwned` detaches only on Windows. Its `OwnedChild.exited` records the main child exit. `cleanupOwned` treats that exit, or a stored attached PID that is absent, as enough to call `released`. `released` saves `stopped`, removes the profile, and saves `released`. That first inference is wrong for the observed helper. The parent test worker and Chrome also share an inherited group, so signaling that existing group would be unsafe.

This design replaces the POSIX inference with a dedicated process group lifetime observation. It does not change the work service, borrowed-context policy, execution deadline, seven-second Chrome cleanup cap, cleanup retry count, desktop shutdown budget, or SQL migrations 001 through 004.

## Shape

The data shape separates a lifetime witness from termination authority.

```ts
// These values are parsed from a journal schema or constructed at spawn.
// Neither value carries permission to send SIGTERM or SIGKILL.
type PosixFamily = {
	kind: 'posix-group';
	pgid: number;
};

type FamilyObservation =
	| { kind: 'empty'; proof: PosixEmptyProof }
	| { kind: 'present' }
	| { kind: 'unobservable' };

type PosixEmptyProof = {
	kind: 'posix-group-empty';
	pgid: number;
};

type StoppedProof =
	| { kind: 'never-spawned' }
	| PosixEmptyProof;

// The retained ChildProcess is process-local authority only.
// It is never reconstructed from a journal PID.
type OwnedChild = {
	child: ChildProcess;
	exited: boolean;
	failedToSpawn: boolean;
	family: PosixFamily | { kind: 'windows-child-only' };
};

function spawnOwned(executable: string, args: string[]): OwnedChild;
function observeFamily(family: PosixFamily): FamilyObservation;
function waitForFamilyEmpty(
	family: PosixFamily,
	signal: AbortSignal,
): Promise<FamilyObservation>;
function stopOwnedChild(owned: OwnedChild, signal: AbortSignal): Promise<void>;
```

The final implementation should derive journal witness types from the Zod schema instead of maintaining duplicate interfaces. The sketches use named shapes to show responsibility. The process module does not import the driver or work service. It returns `present` or `unobservable`; the driver translates the former to bounded `CLEANUP_FAILED` and the latter to `OWNERSHIP_UNCERTAIN`.

On POSIX, `spawnOwned` uses `detached: true` with ignored stdio and no shell. Node creates a new process group and session for the child. The child PID is the group ID. It must be a positive safe integer greater than one, distinct from the worker PID, and originate from that exact successful owned spawn. No external caller can supply a group to spawn. No inherited group enters the lifetime witness.

`observeFamily` performs `process.kill(-pgid, 0)`. Signal zero delivers no termination signal. Only `ESRCH` establishes emptiness. Success means present. `EPERM` and every other failure mean unobservable. It never scans command lines or terminates a group. A reused group can delay cleanup conservatively; its presence cannot authorize killing its members. An absent group proves the original inherited group cannot contain a surviving member.

`waitForFamilyEmpty` uses the existing abort-aware polling pattern. It shares the caller's cleanup signal and introduces no fresh timeout or retry budget. A live helper can remain present until the signal aborts. The driver returns blocked and keeps the family journal and reservation. On later recovery, the same read-only observation can succeed after the helper exits. This shape accepts lack of cold force-termination in exchange for avoiding termination based on stored numeric identifiers.

The family observation is separate from `awaitChildExit`. Keep the latter only where waiting for the main child has independent value. Delete every POSIX route that lets `live.exited`, `processAbsent(state.pid)`, or a failed CDP connection bypass the family barrier. The sole profile-removal route requires a durable sufficient stopped proof, or a journaled prepared operation that never attempted launch.

## Durable states and transitions

New POSIX launched records use a versioned launch branch in `chromeStateSchema`. Keep legacy input records readable. Do not silently convert legacy evidence into version-two proof.

| Record | Meaning and next action |
| --- | --- |
| Existing prepared launch | No spawn attempted. Profile removal is safe. It can transition to a stopped record with `never-spawned` proof. |
| Version-two attempted | Write-ahead launch risk exists. No durable family witness yet. Only a retained live spawn handle can complete recovery. |
| Version-two spawned with family | A dedicated family was launched and its witness persisted. Attachment may not have completed. |
| Version-two attached with family and existing Chrome identity | Same family plus the current CDP identity proof. |
| Version-two stopped with stopped proof | No owned writer can resume from the witnessed group. Profile removal may be retried without CDP or process lookup. |
| Released | Cleanup already completed under the record's historical contract. Terminal. |

The new successful POSIX sequence is `prepared`, `attempted`, `spawned`, `attached`, `stopped`, `released`. `attempted` precedes spawn. `spawned` follows successful OS spawn and precedes the public spawned checkpoint, connection attempts, or acquisition return. Permit `spawned` to move directly to `stopped`, and permit `attempted` to move to `stopped` only with locally retained proof that spawn failed without creating a process, or after observing the local launched family empty. `attached` preserves the exact family witness instead of rebuilding it from the attached browser PID.

There remains an unavoidable crash window between OS spawn and persisting `spawned`. A fresh driver then sees attempted without a family and reports `OWNERSHIP_UNCERTAIN`. It does not replay launch, guess a group from a PID, or remove the profile. Closing this availability gap would require a launcher protocol. The existing honest uncertainty contract already permits this outcome.

A new stopped record carries its stopped proof. Profile removal must finish before `released`, with signal checks before and after the awaited operation. Cancellation during removal preserves stopped and the obligation. A later retry removes any remainder. The non-abortable filesystem operation may finish after cancellation, as today, but cannot race a member of the now-empty owned group.

## Lifecycle cases

Normal completion requests `Browser.close` only after existing ownership verification. It then waits for group emptiness, persists stopped, removes the profile, and resolves cleanup. Main PID exit alone changes no release decision.

Cancellation or execution timeout stops the main browser through the verified CDP connection or the retained child handle. It waits for family emptiness using the cleanup signal. If a helper remains, cleanup ends bounded and blocked. No signal escalation targets a group or a stored PID. The existing child-only escalation remains restricted to its retained handle and existing duration.

An acquire result lost after `spawned` leaves a durable family witness. The service already has its obligation before acquisition. Recovery never calls acquire again. It may close a verified live browser, or directly wait for the recorded group to become empty after main exit. The profile remains untouched while any inherited helper survives.

A fresh driver recovering a main-gone attached or spawned operation does not need CDP availability. It observes the dedicated group. A present group with main absent is the exact proven bug case. Capacity stays reserved. Once that group is empty, profile removal and release proceed.

Spawn failure with a retained handle and `failedToSpawn` can produce `never-spawned`. A fresh driver cannot infer failed spawn from absent discovery. It remains uncertain if no durable family exists.

Borrowed sessions keep their existing known-context disposal and verification. They never enter a process-family helper, receive a termination signal, or have a profile removed.

## Existing journal policy

Legacy prepared records remain safely cleanable because no launch was attempted. Legacy attempted, attached, and stopped records without a sufficient group witness remain uncertain when cleanup needs family proof. In particular, legacy stopped meant only main process termination. It cannot be interpreted as version-two family emptiness merely because its phase name matches.

A verified legacy live browser can be closed through CDP, but that does not create a missing dedicated-group witness. Its legacy cleanup obligation stays visible. A fresh driver cannot repair historical proof by reading its current process group because the observed inherited group contains unrelated worker processes. Existing released records stay terminal. There is no reservation left to recover or honest evidence to reconstruct retroactively.

Use JSON-schema evolution inside `chrome_operations.state`. Preserve the historic SQL migration files byte-for-byte. Tests should load raw legacy JSON for compatibility cases rather than constructing new states through a current writer and pretending they came from an old version.

## Windows boundary

A POSIX group fix does not establish Windows family cleanup. Windows `detached` and `ChildProcess.exit` do not constitute an equivalent lifetime witness. A process tree scan or `taskkill /T` after main exit cannot recover an orphaned helper tree with certainty.

For the narrow proven-defect correction, preserve normal Windows launch, execution, borrowed context handling, and current direct-child cleanup behavior. Do not make Windows acquisition fail or force every successful Windows task into blocked cleanup merely because POSIX APIs are unavailable. Keep the Windows implementation visibly separate and label its proof as child-only in internal state and engineering evidence. Do not emit a POSIX stopped proof on Windows.

This choice is a scoped engineering correction, not a claim that the full family invariant is now cross-platform. If current P0-P6 acceptance requires family proof on Windows as well, this scoped design alone cannot meet it. That gate needs a Windows Job Object adapter before acceptance. The appropriate Windows design creates Chrome inside a Job Object before allowing it to run, uses job active-process count as the family witness, and prevents breakaway. Atomic assignment through `PROC_THREAD_ATTRIBUTE_JOB_LIST` avoids an orphan between process creation and job assignment. Live handles grant stop authority; a durable authenticated launcher or recoverable job protocol supplies cold observation. This is real native lifecycle work with packaging and Windows runtime tests. Replacing it with a process-list heuristic would fabricate proof.

Formal release verification may be deferred under the user's scope. A Windows family assertion may not be described as proven merely because Windows smoke tests pass. The synthesis owner must state whether current engineering acceptance is POSIX-scoped or includes this additional Windows adapter. No user approval is needed to decide routine implementation details; the unresolved matter is an acceptance claim, not a request to disable Windows.

## Alternatives and synthesis decision

The selected shape is a dedicated POSIX group with read-only durable absence observation. It adds one owned-lifetime fact and one release barrier. It keeps browser identity in the driver and OS observation in the process module. The work service retains its current two-outcome cleanup interface. This is a deep boundary because the caller does not learn process groups, CDP, or journal phases.

A persistent supervisor with an authenticated local socket was the structurally different alternative. The supervisor could keep in-memory launch authority across driver restarts, anchor a group, and expose stop-and-drain. It also requires a separate executable lifecycle, protocol parsing, authentication, startup handshakes, durable endpoints outside the profile, packaged resources, and recovery for supervisor death. It closes the small spawn-before-journal availability gap, but it adds a long-lived component to solve a defect that read-only cold observation can address. It loses on scope and additional failure modes for this proven POSIX defect.

A native cross-platform family launcher with Windows Job Objects was the second alternative. It provides the strongest cross-platform contract and can hide its internals behind a similarly small interface. Its native resource packaging and platform validation are substantial. It is the correct next shape if Windows family completeness is an immediate acceptance requirement. This artifact does not claim its implementation or proof exists.

Persisting a list of renderer and helper PIDs loses because helpers can spawn between snapshots and child PID reuse defeats termination authority. Delayed repeated `rm` and immediate `stat` lose because a surviving writer can act after either check. Signaling the existing inherited group loses because it contains the test worker. A new group followed by cold termination from a stored group ID loses because the group may have been reused. No selected code sends SIGTERM or SIGKILL to any group.

Model the Domain shaped the new spawned and proven-stopped states. Type System Discipline separates family evidence from termination authority and uses discriminated outcomes. Laziness Protocol selected the read-only group barrier over a daemon protocol. The design-red-flags screen rejects split ownership of release policy and avoids a second cleanup path that could bypass the barrier.

## Deterministic fixture and verification plan

Use real Chrome and a POSIX executable launcher fixture. The launcher starts a helper in its inherited group, records the helper ready handshake outside the managed profile, and then `exec`s the configured real Chrome with its original arguments. Chrome retains the launched PID, so the existing CDP PID and ownership checks still run. The helper waits on a named pipe outside the managed Chrome root. Commands ask it to create a marker under the exact profile and then acknowledge, or to exit. The fixture uses positive handshakes instead of a sleep intended to approximate Chrome shutdown.

Verify the fixture's Chrome PGID equals its launched PID. Verify the helper shares that PGID. Verify the test worker has a different PGID. If those facts fail, the fixture must fail before its cleanup assertions.

Run these behavior cases against the actual driver and work service:

1. Acquire real Chrome, record its returned resource, close the main browser through a separate verified CDP connection, and prove its PID absent. Hold the helper. Recover through a fresh driver and reopened storage. Assert the operation retains its family state, profile marker, reservation, and page capacity. A queued run that needs that capacity stays queued.
2. While cleanup is waiting, command the held helper to write into the exact profile and await its acknowledgement. Assert the profile still exists and cleanup has not resolved. This directly challenges the previous false boundary.
3. Release the helper and observe group absence. The recovery cleanup may then save stopped, remove the profile, save released, and free capacity. If finite attempts were exhausted in the held phase, use a fresh service to obtain the existing recovery retry budget rather than increasing production retries.
4. Abort the cleanup signal while the helper is held. Race only the return against a small test bound. Assert bounded `CLEANUP_FAILED`, no profile deletion, no released state, and a retained obligation. Release the helper and recover successfully later.
5. Throw at the existing spawned checkpoint. Assert the durable phase already includes the family witness, acquisition does not return a resource, execution never runs, and the same family barrier protects recovery.
6. Exercise ordinary successful launched work and cancellation with real Chrome. Assert both eventually release after group emptiness. Exercise borrowed Chrome with an unrelated retained tab. Assert the browser and tab survive.
7. Load legacy attempted, attached, and stopped journal rows without witnesses. Assert no process termination or profile deletion and visible ownership uncertainty. Load a legacy prepared row and prove its safe cleanup still works. Keep existing partial-removal retry coverage using a version-two proven-stopped record.

Verify the configured Chrome session root before fixture teardown. Read its entries and assert the managed operation directory is absent after success. Also check the direct profile path for `ENOENT`. Capture the journal, group observation, marker handshakes, and root listing in any failure artifact before teardown removes anything. Stop the fixture helper through its pipe and wait for its group to become absent before disposing the test namespace. Teardown is never the evidence that product cleanup succeeded.

Run the existing Chrome integration namespace, process tests, journal tests, full typecheck, and boundary checks. The focused fixture is POSIX-only with an explicit platform condition. Preserve the existing Windows real-Chrome integration cases. A passing POSIX fixture establishes inherited-group cleanup for the exercised Chrome build and OS. It does not prove that arbitrary executables cannot escape through `setsid`, that every future Chrome version preserves helper groups, or that Windows has Job Object containment. Those boundaries belong in the engineering acceptance evidence.

## Implementation reconciliation

No implementation occurred. No tests ran and no empirical family-proof claim is made by this document. The first implementation unit is the dedicated POSIX spawn and read-only group observation, followed by the versioned journal states and the single profile-removal barrier. Reconcile the Windows acceptance boundary before treating this candidate as a complete cross-platform fix.
