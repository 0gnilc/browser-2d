# Owned Chrome family lifetime, candidate A

## Caller usage

The user wants the current P0 through P6 engineering audit fixed, with formal release deferred. The caller must keep the device and page reservation until every owned profile writer has stopped and profile deletion has completed. A browser-main exit is insufficient. The supplied native proof identifies an orphan Chrome Helper recreating a profile after `rm` succeeded.

The work service API stays unchanged. It receives `resolved` only after the driver proves family drain and removes the profile. It receives `blocked` on uncertainty or a deadline. It retains the existing obligation and reservation in either blocked case.

```ts
const driver = createChromeDriver({ root, journal });
const resource = await driver.acquire(intent, executionSignal);
await driver.execute(resource, run, executionSignal);
const result = await driver.cleanup(intent, cleanupSignal);
```

The owned launch caller inside the Chrome driver gains one durable intermediate state. This sketch describes the contract, not implementation.

```ts
journal.save(operationId, { version: 2, mode: 'launch', phase: 'attempted' });
const owned = spawnOwned({ executable, args, operationId, ownerToken });
children.set(operationId, owned);
const started = await owned.ready;
journal.save(operationId, {
  version: 2,
  mode: 'launch',
  phase: 'spawned',
  family: started.witness,
});
await checkpoint?.('spawned', operationId, signal);
// Existing CDP verification and context creation follow.
```

The family operation stays behind one process-layer function. The driver does not inspect process trees or implement platform branching.

```ts
await requestExistingVerifiedBrowserCloseOrStopLiveChild();
const proof = await awaitOwnedFamilyEmpty({ witness, live, signal });
if (proof.kind === 'uncertain') return uncertain();
journal.save(operationId, {
  version: 2,
  mode: 'launch',
  phase: 'stopped',
  proof: proof.proof,
});
return removeProfileAndRelease(intent, signal);
```

`requestExistingVerifiedBrowserCloseOrStopLiveChild` is pseudocode for the existing owned cleanup policy, not a proposed extra forwarding function. A cold observer cannot signal a PID or process group read from the journal. The live capability can stop its own main process using the existing retained OS handle. A CDP connection can close only a browser which passes the current owner-token, exact-profile, hash, PID, and start-identity checks.

## Grounding

`apps/worker/src/browser/process.ts:43` stores a live ChildProcess and two booleans. Its launch at line 49 detaches only on Windows. Therefore present POSIX Chrome inherits the test worker's group. That inherited group must never be signaled or treated as a private namespace.

`apps/worker/src/browser/chrome-driver.ts:105` records attempted before spawn. Its first asynchronous checkpoint follows spawn. Attachment writes browser identity only after CDP verifies the command line and browser PID. `cleanupOwned` at lines 207 through 210 presently treats main exit or main absence as permission to remove the profile. The fallback at line 216 also stops only the main child. All of these paths need the same family-drain boundary.

`released` at line 179 already orders stopped, awaited profile removal, and released. This is the right ordering once stopped means the family cannot write again. It is currently false for old stopped records, because the old code wrote them after main exit alone.

`apps/worker/src/work/service.ts` owns finite attempts, deadlines, capacity retention, recovery scheduling, and shutdown orchestration. None of those policies need changing. The browser layer has a seven-second maximum cleanup budget and the work service can provide a shorter budget.

`apps/worker/src/browser/journal.ts` persists strict JSON states in the existing `chrome_operations.state` column. Extending that JSON schema needs no business SQL migration. Migrations 001 through 004 remain byte-identical.

## Shape

Choose a dedicated owned-family witness, recorded immediately after launch and before any acquisition checkpoint. Keep the operating-system mechanics in `browser/process.ts` initially. A separate platform adapter is justified only for the Windows Job controller, whose implementation has a different runtime and packaging requirement.

The public worker contracts and work service remain unchanged. `ChromeState` is inferred from the journal's Zod schema. The following types show the variants; implementation derives them from that schema rather than maintaining another authoritative union.

```ts
type FamilyWitness =
  | { kind: 'posix-group'; groupId: number }
  | { kind: 'windows-job'; jobName: string; receiptToken: string };

type FamilyEmptyProof =
  | { kind: 'never-started' }
  | { kind: 'family-empty'; witness: FamilyWitness };

type FamilyObservation =
  | { kind: 'empty'; proof: FamilyEmptyProof }
  | { kind: 'uncertain' };

type OwnedLaunch = {
  ready: Promise<{ witness: FamilyWitness; mainPid: number }>;
  stopMain(signal: AbortSignal): Promise<void>;
  awaitMainExit(signal: AbortSignal): Promise<void>;
};

function spawnOwned(input: {
  executable: string;
  args: string[];
  operationId: string;
  ownerToken: string;
}): OwnedLaunch;

function awaitOwnedFamilyEmpty(input: {
  witness: FamilyWitness;
  live: OwnedLaunch | undefined;
  signal: AbortSignal;
}): Promise<FamilyObservation>;
```

`OwnedLaunch` is a live capability and never serialized. `FamilyWitness` permits observation only. It exposes no termination method and cannot be accepted by a termination API. This follows Type System Discipline. The model separates family existence from main-process existence, following Model the Domain. Keep the same browser directory and existing service API, following Laziness Protocol.

`spawnOwned` returns its live capability synchronously. The driver immediately stores it before awaiting `ready`. `ready` resolves only when the dedicated namespace exists and includes the main PID. It rejects on startup failure, while the retained capability still owns cleanup of anything created during startup. The process module privately distinguishes proven never-started from a started family. Cleanup never infers that distinction from rejection alone. This preserves the current immediate `children.set` safety while moving journal persistence before the spawned checkpoint. Existing CDP verification compares its main PID with `(await live.ready).mainPid`; it does not confuse a Windows controller PID with Chrome's PID.

The new launch states are version 2 prepared, attempted, spawned with family witness, attached with the same family witness and current browser identity, stopped with an explicit proof, and released. Borrowed states remain as they are. A version-2 stopped row is the only launched row from which filesystem removal can resume without consulting a live family. An unattempted prepared operation can transition to stopped with never-started proof.

Avoid optional `groupId` fields added to every state. They permit a new caller to accidentally attach without the required witness. Use distinct discriminated states. The parser recognizes existing unversioned records as legacy, including legacy stopped. No parser upgrade fabricates family-empty proof.

## POSIX mechanism

Launch with `detached: true`. Node must report successful spawn before journaling the family witness. The new process is the dedicated group leader. Persist its PID as the group ID only for this freshly detached launch. Record the witness before the existing spawned checkpoint. Verify namespace isolation in the actual macOS and Linux integration runs.

After main shutdown, poll the dedicated group using `process.kill(-groupId, 0)`. Only `ESRCH` is empty. Success means some member is present. `EPERM` and any other error mean uncertain. Wait with the existing abort signal and the existing poll interval. Do not add a grace sleep. Do not use a string search of command lines as a proof of absence.

This design sends no termination signal to a process group, even a dedicated group. Live fallback can still terminate the main ChildProcess through the retained handle. Remaining helpers are allowed to exit. A stuck helper makes cleanup bounded and blocked. This is a deliberate exchange of automatic recovery for ownership safety. It also avoids a group-ID reuse race in a group termination API.

Cold recovery can observe a stored dedicated group. An ID reused by an unrelated new group may cause conservative retention. It cannot cause an unrelated process to be terminated. Legacy records never establish that a group was dedicated, even when a later `ps` query happens to show group ID equal to main PID.

A POSIX group is not a security sandbox. A descendant that deliberately leaves the group is outside this witness. This candidate is correct for the evidenced Chrome family only after the actual supported Chrome namespace checks show that profile writers stay in the dedicated group. A helper intentionally calling `setsid` and then writing the profile is a counterexample and must not be described as covered. If supported Chrome does that, reject this candidate rather than broadening a process-name heuristic. Linux cgroups or a native supervisor with stronger process tracking would then be needed. A snapshot cannot establish that escaping descendants never existed.

## Windows behavior

Do not turn off Windows task admission or force every normal Windows cleanup to uncertain because a POSIX primitive is unavailable. Do not quietly retain the old main-PID release path and call the result cross-platform family safety.

The equivalent complete Windows design uses a Job object owned by a small controller. The controller creates the main process suspended, assigns it to a private Job before any Chrome code can run, and resumes it. The Job excludes breakaway. The controller retains the main process handle and Job handle. Existing CDP ownership checks still verify the main PID reported by this controller.

Keep this controller alive independently of the worker, with a private per-operation endpoint and unguessable receipt token. It can stop the exact main process using its retained handle. It reports completion only after the Job's active-process count reaches zero. At that point it writes an atomic family-empty receipt outside the profile directory. The receipt identifies the operation and receipt token, so a fresh driver can distinguish this operation's completion from an old file. The controller never writes the profile. The driver removes the receipt only after saving the version-2 stopped proof.

If the worker dies, the controller continues until the family is empty and writes the receipt. If the controller crashes before proof is persisted, cold recovery remains uncertain. A missing controller, missing named Job, failed query, or absent main PID is not a synthetic completion receipt. Normal Windows launches still execute and release when their family exits. A controller bootstrap failure occurs before the suspended Chrome process is resumed, or retains its live cleanup capability. Never fall back to an uncontained launch.

This is a concrete Windows implementation direction, not verified code. This environment has not executed a Windows controller or checked its packaging. The native API ordering, suspended-process failure cleanup, Job accounting behavior, atomic receipt durability, and actual Chrome compatibility need a Windows implementation and real tests before cross-platform engineering acceptance. A PowerShell process using in-memory C# interop may reduce build changes, but startup cost and enterprise policy compatibility must be measured before choosing it. A bundled native helper has clearer deployment behavior and more packaging work. That packaging choice remains a synthesis decision, not grounds for disabling Windows.

## Transitions and failure paths

Normal completion goes prepared, attempted, spawned, attached, family empty, stopped, profile removal, released. The work service clears the reservation only after released returns resolved.

Cancellation after spawn uses the retained live capability or a verified CDP close. It then awaits family drain within the same cleanup signal. Cancellation before the group or Job is empty leaves spawned or attached durable and returns CLEANUP_FAILED. It neither removes the profile nor releases capacity.

Acquisition result loss after attached keeps the attached journal with its family witness. Recovery cleans that obligation without replay. Acquisition loss after spawned but before attachment keeps the spawned witness. Recovery may close a verified browser if one is discoverable; otherwise it can still wait for proven family absence. It never sends a signal to a saved ID. An attempted record written before launch, followed by a crash before the witness save, is deliberately uncertain. This closes no gap by guessing that launch never happened.

A failed spawn known through a retained live launch handle can produce never-started proof. A cold attempted row with no receipt cannot. Before the first attempted write, prepared is proof that no external launch was authorized by this driver, so profile-only cleanup remains safe.

Cold recovery with main gone and helper alive retains spawned or attached. On POSIX it observes the dedicated group. On Windows it awaits the authenticated completion receipt or live controller proof. Only empty proof permits stopped. Partial removal remains stopped and can be retried with a fresh driver exactly as the current profile-removal tests expect.

Legacy prepared remains safely unattempted. Legacy attempted, attached, and stopped cannot be upgraded to family-empty from main absence. Keep their resources visibly uncertain. A legacy live in-memory handle which did not launch into a dedicated namespace cannot produce the new proof either. Existing released records stay terminal because capacity has already been released; this change cannot reconstruct historical cleanup obligations from a terminal record. Record that historical limitation in acceptance evidence.

Borrowed creation, disposal, and browser survival remain unchanged. The family API is never used for connect-mode records. No borrowed browser or unrelated tab receives Browser.close or an OS signal.

## Alternatives and selection

A main-process exit followed by repeated profile removal is rejected. It has a small interface but hides no family ownership and cannot prevent the proven late writer. A final stat or arbitrary delay has the same defect.

A process-tree snapshot keyed by PPID is rejected. The supplied helper already has PPID 1, and snapshots miss descendant creation between observations. It makes callers coordinate scanning and termination while still providing no durable lifetime proof.

A universal supervisor on every platform is structurally viable. It can centralize launch and durable receipts. It loses for the present POSIX defect because it introduces an IPC protocol, executable packaging, supervisor crashes, and another persistence boundary where a private group observation suffices for the evidenced Chrome behavior. Use that larger shape only if namespace verification rejects the smaller POSIX model.

The selected base is a private POSIX group witness plus a common proof boundary before stopped. The Windows Job controller is the platform adapter needed for the same guarantee. The current engineering fix can be implemented and verified on POSIX without implementing a universal daemon, but it cannot honestly be labeled complete Windows family safety until that adapter is exercised. This is a design limitation, not a request to waive the Windows requirement.

## Deterministic verification plan

Create a POSIX executable launcher that starts a gated helper and then uses `exec` to run the real configured Chrome with every original argument unchanged. The helper publishes a ready event over a test-owned FIFO or socket outside the profile and waits for an explicit release message. It inherits the newly dedicated group. No arbitrary sleep controls the race.

Acquire real Chrome and assert CDP main PID equals the launch PID. Capture the main group, helper group, and test-worker group through OS inspection. Require main group equals helper group and differs from the test group. Keep an unrelated sentinel process in the test group and a borrowed sentinel Chrome alive throughout.

Close the main browser through a separate CDP observer. Wait for main absence while the helper remains gated. Reopen the database and create a fresh driver without the old children map. Invoke cleanup with a bounded signal. Before releasing the gate, assert the obligation still exists, the profile still exists, journal is not stopped or released, and cleanup cannot resolve. Abort this first attempt and require bounded CLEANUP_FAILED with capacity retained.

Release the helper gate. Have it create a marker inside the exact profile and acknowledge the write outside the profile, then exit. The new driver retries within the existing policy or in a fresh service with a fresh retry budget. Require group absence before stopped and eventual profile absence before resolved. Assert empty owned-session root while teardown has not run. Preserve evidence before cleanup so teardown cannot erase a failure.

Run a second fixture checkpoint that throws immediately after spawned was journaled. It proves lost acquisition before attachment retains the family witness and that cold cleanup can drain without replay. Add a journal-only attempted record to prove the no-witness crash window stays uncertain.

Run journal tests for legacy stopped and legacy attached-main-absent records. They must retain capacity and never call profile removal. Keep the existing partial-removal failure and cancellation tests, updated to require explicit version-2 stopped proof. Verify invalid transitions cannot drop the family witness when moving spawned to attached.

On Windows, use a real Chrome plus gated child inside the Job and the same cold-main-gone scenario. Also crash the worker while keeping the controller alive, and crash the controller before completion proof. The first must recover from the receipt. The second must remain uncertain. Test failed assignment before ResumeThread to prove no uncontained Chrome can start. A POSIX-only run is not evidence for these Windows cases.

Namespace checks are acceptance evidence, not a permanent command-name heuristic in production. Enumerate the owned Chrome main and helper namespaces during launch, execution, main exit, and drain. A process escaping the group while retaining profile write access rejects the POSIX candidate. Preserve positive membership observations and the deterministic helper proof. Do not interpret a dropped-event trace as proof of absence.

## Reconciliation and next step

No product code or tests changed in this candidate. The root agent must select the platform scope and exact Windows controller implementation during synthesis. The first implementation unit should add the versioned journal variants and POSIX live-versus-durable family witness, then prove the gated-helper failure on the real Chrome path before broadening verification. Keep the current deadlines, retry count, SQL checksums, and borrowed behavior unchanged.
