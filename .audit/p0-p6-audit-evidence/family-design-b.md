# Owned Chrome family lifetime design B

This design fixes the proven false release boundary so a user's device and page capacity remain reserved until owned Chrome profile writers have stopped. It targets the current P0–P6 engineering audit. Formal release, signing and publication remain deferred. This is a design artifact only. It does not claim that either platform implementation or verification has run.

## Usage first

The work service keeps its current interface. The consumer still calls `driver.acquire(intent, signal)`, executes the returned acquisition, and calls `driver.cleanup(intent, signal)`. Cleanup returns `resolved` only after the family witness permits deletion and profile removal finishes. A held helper returns a blocked result within the existing signal deadline. The work service already keeps the reservation when cleanup blocks.

Inside the driver, launch becomes this sequence.

```ts
journal.save(operationId, { mode: 'launch', phase: 'attempted' });
const family = await launchOwned({ executable, args, signal });
// A synchronous durable save happens before the public spawned checkpoint.
journal.save(operationId, {
  version: 2,
  mode: 'launch',
  phase: 'spawned',
  family: family.witness,
});
children.set(operationId, family);
await checkpoint?.('spawned', operationId, signal);
// Existing CDP verification then persists attached plus the same family witness.
```

Cleanup becomes this sequence. The complete branch belongs in one driver helper so a future caller cannot accidentally bypass it.

```ts
await requestVerifiedBrowserCloseOrStopLiveMain(intent, state, signal);
const drained = await awaitOwnedFamilyDrained({
  witness: state.family,
  live: children.get(operationId),
  signal,
});
if (drained.kind !== 'drained') return uncertain();
journal.save(operationId, stoppedWithFamilyProof(state, drained));
return removeProfileThenRelease(intent, signal);
```

The result-lost path uses the durable operation intent rather than the missing acquisition result. Cold recovery creates a fresh driver, loads the same witness and observes the family without replaying acquire. The work repository and service signatures do not change.

## Grounding

At source b1b592fbacd33f20fc2bf42a7583280b2b6f184d, `browser/process.ts` detaches Windows launches only. `stopOwnedChild` and `awaitChildExit` observe the retained main child. `chrome-driver.ts` accepts `live.exited`, failed spawn, or absent saved main PID as sufficient to call `released`. `released` saves `stopped`, removes the profile and saves `released`. The first invalid inference is main exit implying no remaining owned writers.

The source-bound native proof records main Chrome 9412 and orphaned Chrome Helper 9429 in inherited PGID 9383. Node 9411 successfully removes the profile, then Helper 9429 recreates it with PPID 1. The test's later teardown removes that recreation. The inherited group includes the test worker and must never receive a signal. DTrace dropped events. Its explicit successful mkdir after successful rmdir proves the defect; it does not prove absence elsewhere.

`work/service.ts` already retains capacity on blocked cleanup. It has execution and cleanup deadlines plus finite cleanup attempts. The driver adds its existing seven-second cleanup bound. None of these numbers changes. The desktop shutdown budget also remains unchanged.

## Chosen shape

Choose one small browser process-lifetime module with platform-specific family witnesses. The driver owns CDP ownership and the journal owns durable transitions. The process module owns the meaning of a live launch handle and a drained family. The service should never see PGIDs, Job Objects or helper PIDs.

On POSIX, start each owned Chrome with `detached: true`. Its initial PID becomes a newly created process group and session leader. The journal stores that group ID only because this module created it, never because an arbitrary ps query found it. Existing CDP owner token, exact profile path, browser hash, browser PID and start identity checks remain required before Browser.close. Verify the real Chrome browser PID still matches the launched PID.

After Browser.close or live-main termination, poll the dedicated group's existence using a read-only group query. Only a definitive no-such-group result permits `drained`. Permission errors and observation failures never mean empty. A surviving reparented helper keeps the group observable after the browser leader exits. This design sends no process-group termination signals. Existing retained-child main termination remains available for failed attachment. Cold recovery never turns a stored identifier into termination authority.

A process group is a witness for processes that remain in it. The native verification must establish that the tested supported Chrome builds keep all relevant profile writers there. A Chrome writer that deliberately creates another group would invalidate this witness. If the native evidence finds one, reject group-only containment rather than extending the profile-removal retry loop. This is a correctness condition for the design, not an established fact from the current orphan-helper proof.

Windows needs a distinct witness. An exited ChildProcess, taskkill tree, WMI descendant snapshot or CDP SystemInfo snapshot cannot prove that no surviving descendant can create another writer. For a complete Windows family guarantee, use a narrow native Job Object adapter. It creates the main Chrome suspended, assigns it to a fresh operation-specific job before resuming it, prevents breakaway, retains the job handle, and observes zero active members. The adapter is an ownership implementation, not a general worker supervisor. The driver must compare CDP PID to the actual Chrome PID supplied by the adapter, not the adapter process PID.

The adapter needs a completion receipt outside the profile. It atomically records the operation nonce and zero-active observation before closing its last job handle. A fresh driver can query the named live job without termination rights. If the job is absent, only the matching completed receipt permits release. Missing job plus missing receipt remains uncertain. This avoids equating job-name disappearance or adapter exit with completed process termination. A crash before the receipt may conservatively strand a reservation even if kill-on-job-close eventually killed Chrome.

Normal Windows tasks remain available through this adapter. A task that launches and cleans up normally reaches the zero-active receipt and releases capacity. Do not ship a policy that always refuses Windows acquire or always blocks every normal Windows cleanup. If adding and verifying this native Windows adapter exceeds the present implementation scope, preserve the existing Windows execution path and explicitly leave Windows family-proof acceptance open. That smaller POSIX-only patch must not be described as a cross-platform completed lifetime fix.

## Type and signature sketch

These are sketches. Authoritative Zod schemas own stored JSON, and TypeScript types derive from them. The discriminated witness makes unsupported evidence distinct from valid family proof. Numeric brands must come from boundary validation. A positive integer from disk is data, never a live termination capability.

```ts
type FamilyWitness =
  | { kind: 'posix-group'; groupId: ProcessGroupId; leaderPid: ProcessId }
  | {
      kind: 'windows-job';
      jobName: JobName;
      receiptPath: ReceiptPath;
      nonce: OperationNonce;
    };

type OwnedLaunch =
  | {
      kind: 'posix-group';
      witness: Extract<FamilyWitness, { kind: 'posix-group' }>;
      main: OwnedChild;
    }
  | {
      kind: 'windows-job';
      witness: Extract<FamilyWitness, { kind: 'windows-job' }>;
      mainPid: ProcessId;
      adapter: LiveJobAdapter;
    };

type DrainResult =
  | { kind: 'drained'; witness: FamilyWitness }
  | { kind: 'uncertain' };

function launchOwned(input: {
  executable: string;
  args: string[];
  signal: AbortSignal;
}): Promise<OwnedLaunch>;

function awaitOwnedFamilyDrained(input: {
  witness: FamilyWitness;
  live: OwnedLaunch | undefined;
  signal: AbortSignal;
}): Promise<DrainResult>;

function stopLiveOwnedMain(input: {
  live: OwnedLaunch;
  signal: AbortSignal;
}): Promise<void>;
```

`LiveJobAdapter` and live child handles stay internal and cannot be reconstructed from JSON. The stop method has no overload accepting FamilyWitness or a raw PID. There is no API for signaling an inherited group or terminating a recovered family from saved IDs.

For the durable launch state, add a v2 branch alongside the existing strict legacy schema. Keep connect state unchanged.

```ts
type LaunchV2 =
  | { version: 2; mode: 'launch'; phase: 'spawned'; family: FamilyWitness }
  | {
      version: 2;
      mode: 'launch';
      phase: 'attached';
      family: FamilyWitness;
      browserHash: BrowserHash;
      pid: ProcessId;
      processIdentity: string | null;
    }
  | {
      version: 2;
      mode: 'launch';
      phase: 'stopped';
      family: FamilyWitness;
      proof: 'family-drained';
    }
  | { version: 2; mode: 'launch'; phase: 'released' };
```

Prepared and pre-spawn attempted retain the legacy shape. Versioned v2 `stopped` means family drain was witnessed. Legacy `stopped` means only that old code thought the browser stopped. Never collapse these meanings in a helper that reads only `.phase`.

The public module is small because it hides group observation, Windows handles, cancellation and zero-active receipts. The driver still makes CDP ownership decisions and profile-removal decisions. Passing the witness around is necessary for persistence; callers do not coordinate multiple OS queries themselves.

## State transitions

1. Prepared has never spawned anything. A missing executable stays prepared and can safely remove an unused profile and release.
2. Attempted is durable before spawn. Launch may have happened, and replay is forbidden. A process crash between actual spawn and witness save leaves attempted without family proof. Cold cleanup remains OWNERSHIP_UNCERTAIN. This is safe and bounded, even though it cannot automatically reclaim capacity.
3. Spawned has a durable family witness. The witness save precedes the existing spawned checkpoint. Pre-attachment cancellation can stop the retained main, then wait for family drain. A fresh driver can wait for family drain if main already exited. If the main is alive but CDP is unavailable, cold cleanup cannot terminate by saved PID and remains blocked.
4. Attached adds existing verified Chrome identity to the same family. Normal completion and cancellation request verified Browser.close, then await family drain. Main PID absence alone only skips a main wait; it never skips the family wait.
5. Stopped v2 exists only after family drain. An interrupted or denied profile rm preserves stopped plus the reservation. A fresh driver may retry profile rm from this persisted proof.
6. Released follows completed rm and the final signal check. Repository.resolved then frees device and page capacity. If the signal already aborted, leave the cleanup obligation even when an underlying rm subsequently finishes.

An abort while a helper is held returns CLEANUP_FAILED, keeps the profile and keeps the last pre-stopped state. Finite service attempts remain finite. A later process restart or otherwise existing retry path can retry once the helper has drained. No new infinite retry loop or arbitrary delay is introduced.

Acquire-result loss does not require special lifecycle state. Spawned or attached is durable independently of the returned acquisition. The existing work service cancellation and recovery already clean by intent. The only required driver change is that their shared cleanup reaches the family barrier.

## Existing journal policy and SQL

Keep business migrations 001–004 byte-for-byte unchanged. Existing chrome_operations already stores JSON. This state extension needs schema/parser and transition changes, not a rewritten SQL migration.

Legacy prepared remains safe because existing code saves attempted before calling spawn. Legacy attempted and attached without a live current-process family witness remain ownership-uncertain after cold recovery. Legacy stopped also remains uncertain because old code could persist it while an orphan helper still lived. Closing a correctly verified legacy browser does not manufacture a dedicated group or retroactively prove family drain.

Already released legacy records remain historical. They cannot be certified by the new invariant, and this patch cannot recreate cleanup obligations that the repository already discarded. Do not silently rewrite those records with v2 proof. New launches use v2 once a family witness exists. Parser tests must cover legacy JSON, v2 JSON, invalid witness values and forbidden transitions.

## Deterministic real-process regression

Use a POSIX executable shell launcher that starts a separate gated helper and then execs real Chrome with the exact original arguments. Exec preserves the launch PID, so existing CDP PID verification still passes. The helper and Chrome inherit the newly dedicated group. Place the control and observation gates outside the profile so production profile deletion cannot delete the controls.

The helper announces readiness, waits for a command, writes a marker inside the exact owned profile, announces write completion and waits for a final exit command. The test never infers helper readiness or exit from a fixed sleep. After readiness, acquire real Chrome, close it through a separate observer and positively observe the main PID exit. Drop the original driver and reopen the database so recovery has no live child map.

Start cleanup through the normal work service with one bounded attempt. While the helper stays held, assert the family group is still present, the profile still exists, no resolved journal appears, the original resource remains visible, and another device's run remains queued by retained page capacity. The test can then command the helper to write after main exit. A blocked or cancelled cleanup must not have deleted the profile before this write.

For the successful branch, start fresh recovery after the held helper exits. Cleanup must observe group absence, persist stopped, remove the profile, persist released and clear the resource. Assert absence only after obtaining the helper-exited acknowledgement and an OS observation that the group drained. Inspect the operation namespace before teardown. Teardown must not be the operation that makes the assertion pass.

For cancellation, hold the helper beyond the caller's existing cleanup signal, abort and assert bounded return, blocked reason, no stopped/released proof, preserved profile and preserved obligation. Release the helper only after assertions, then use a fresh driver to finish cleanup. Add a spawned-checkpoint interruption variant to exercise pre-attachment cleanup, and a result-lost variant to exercise intent-driven cleanup.

The Windows regression uses the real native job adapter plus a held writer assigned before resume. Test both normal success and cold recovery with only the saved job witness. Verify missing job without matching completion receipt stays uncertain. Verify adapter crash, inherited/nested job constraints, suspended assignment failure, receipt failure and cancellation without disabling a normal Windows run. A native Windows run is required before marking Windows family cleanup accepted.

Retain existing borrowed-browser tests. Their sentinel tabs and unrelated contexts must stay alive. Keep the forged discovery-file refusal case. Update old tests that expected bare legacy stopped to be trusted; their old expectations encode the invalid release boundary.

## Native namespace verification

Run the exact built worker source and pinned Chrome on the affected Intel macOS environment. Record source commit, runtime, Chrome executable/build, operation ID, owned root, worker/main/helper PID, PPID, PGID and process start identities. Confirm the worker PGID differs from the owned Chrome PGID and the helper PGID equals the dedicated owned group. Record exact helper-ready, main-exited, cleanup-blocked, helper-write, helper-exited, group-empty, successful rmdir and journal-release events.

Use the existing source-bound mkdir/rmdir attribution workflow for positive native evidence. Inspect the root namespace before fixture teardown. Preserve entry/return status and process identity for each relevant native event. Dropped tracing events prohibit an absence claim. The deterministic gate and OS family-empty observation establish the test ordering; a syscall trace supports attribution. A single post-rm stat or a clean teardown is insufficient evidence.

## Alternatives and synthesis

The selected base is a dedicated family witness behind the existing process module. POSIX groups solve the proven inherited-group defect with a narrow change. Windows Job Objects are the necessary platform-specific counterpart for the same guarantee, subject to real platform verification. This choice follows Fix Root Causes. It moves the release boundary to family drain. It follows Model the Domain and Type System Discipline. V2 stopped has a different durable shape from legacy stopped, and stored witness data cannot enter the live stop API. Laziness Protocol keeps service interfaces and budgets unchanged.

A recursive process snapshot plus PID/start-time list is structurally different but loses. It exposes discovery and ancestry races, and helpers can create children or reparent after the snapshot. A deeper wrapper around that snapshot cannot turn it into an OS family lifetime witness.

A general persistent launcher supervisor could journal startup before exec, publish completion and centralize process control on every platform. It closes the small spawn-before-witness capacity leak. It loses for this correction because it creates a second long-lived service, launch handshake, recovery protocol and crash policy where conservative attempted-state uncertainty is already safe. The narrow Windows native adapter exists only because Node exposes no equivalent Job Object handle.

A POSIX-only group patch with unchanged Windows behavior is a valid narrower response to the proven macOS defect. It preserves normal Windows operation and must retain an explicit Windows proof limitation. It cannot close a cross-platform acceptance item that requires all owned families to drain.

Repeated rm, a delayed stat and arbitrary sleep lose because a future live writer can recreate the profile afterward. Negative-group termination from the old journal loses because the stored group was inherited and includes the worker. CDP Browser.close plus main PID absence loses on the recorded Helper 9429 event.

## Accepted costs and implementation reconciliation

We accept retained capacity for an unwitnessed spawn crash or ambiguous old record in exchange for no fabricated ownership proof. We accept a possibly blocked cleanup for an unrelated reused POSIX group ID in exchange for using only read-only cold observation. We accept a native Windows adapter only if full Windows family acceptance is part of the completed claim. We accept no blanket cross-platform completion claim from POSIX tests.

This design remains unimplemented. The parent should reconcile the selected platform scope before handing a contract to an implementation worker. The first implementation unit should add and test versioned lifetime state and the POSIX process module, then run the gated real-Chrome test before changing any acceptance conclusion. A discovered escaping Chrome writer invalidates the POSIX witness and requires a new containment design.
