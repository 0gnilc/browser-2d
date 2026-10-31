# P3/P4 audit at ee6b87d447d99a8e7b0b30c245e7c346c58a1905

The user's goal is to check every P0–P6 requirement against the final plan, complete currently possible engineering and acceptance gaps, and keep signing, notarization, update hosting and formal release deferred. This report covers P3 and P4 only. Google Chrome replaces AdsPower. Legacy payment, subscription and unbounded-retry automation remains deliberately excluded.

Verdict: P3 PASS for the inspected implementation and existing evidence. P4 ISSUES because owned Chrome profile deletion can fail while cleanup is reported resolved. Fresh full matrix acceptance at the exact audit SHA is BLOCKED in this read-only slice because the coordinator reserved the shared Electron/build suites. Historical evidence is explicitly distinguished below.

Baseline was observed with `git rev-parse HEAD`. Source pointers below refer to this exact SHA, not to subsequent coordinator fixes. No implementation, commits, issues, pushes, profile access or shared suites were performed. The only new execution was a fully in-memory fault probe of the actual baseline module, with filesystem and browser dependencies replaced. Output files are under `/tmp` only.

throughput checkpoint: n/a, read-only investigation.

## Method and evidence limits

Read root AGENTS.md, all docs/agents/*.md, final plan docs/monorepo-refactor-plan.md, both P3/P4 design and acceptance records, scheduler repository/service, controlled driver, Chrome journal/driver/connection/process code, worker entry, desktop ownership/client, preload, UI run subscription code, relevant storage/browser/process tests and local CI evidence.

No root GLOSSARY.md or docs/adr directory exists. There was no missing domain document to interpret.

Existing CI evidence `.audit/p3-ci.json` records SHA `2d2e1923a9775aff6ad7650005aa244dba0a15ce`, conclusion success, with successful native Windows x64, macOS x64, macOS arm64 and Linux x64 jobs. `.audit/p4-ci.json` records SHA `4c9706e9654d138c7a72a577f4f70a39a89e51f4` and the same four successful targets. These are local records read directly, not fresh remote CI queries.

`git diff --stat 4c9706e9654d138c7a72a577f4f70a39a89e51f4 ee6b87d447d99a8e7b0b30c245e7c346c58a1905 -- apps/worker/src/work apps/worker/src/browser apps/desktop/src/main/worker-client.ts apps/desktop/src/main/worker-ownership.ts apps/worker/src/entry.ts apps/worker/tests tests/e2e/browser.spec.ts tests/e2e/scheduler.spec.ts` returned no differences. Thus P4 historical evidence covers identical inspected scheduler, Chrome and ownership implementation/tests. It does not prove the entire changed product at the current SHA.

Untracked/generated artifacts were inspected as supplementary historical observations only. `artifacts/mac-x64/chrome-pass-1.json` reports maximumPages 4, maximumBrowsers 2, instances 3 and Chrome/156.0.8078.74. `.audit/p5-p6-evidence/extra-mac-x64/chrome-pass-1.json` records the same limits and Chrome/156.0.8078.80. They are not fresh measurements.

## Actionable findings

### P2 severity, P4 owns the defect, owned profile cleanup is forgotten after deletion failure

Baseline source `apps/worker/src/browser/chrome-driver.ts:179-186` saves `{mode:'launch',phase:'released'}` before attempting `rm(directory, {recursive:true,force:true})`, then suppresses every deletion error and returns `{kind:'resolved'}`. Cleanup's early return at `:348` treats a persisted released state as complete, so the next attempt never retries the directory. The same problem exists if the worker crashes between saving released and removing the directory.

This is reachable from a never-launched prepared operation at `:349`, a confirmed absent/exited owned child at `:193-196`, and a successfully closed owned browser at `:229`. An ordinary EACCES, EPERM or persistent EBUSY on an owned profile can leave owned files after task completion and desktop close. `apps/worker/src/work/service.ts:55-58` trusts the result, and `apps/worker/src/work/repository.ts:223-229` marks its obligation resolved and permits the final terminal state. Subsequent startup does not enumerate these resolved resources. Therefore the failure is hidden, capacity/device exclusion is released, and restart cannot repair the leftover profile through the recorded obligation.

This violates final-plan `docs/monorepo-refactor-plan.md:232` and P4's explicit cleanup-success condition. Final plan's lifecycle section lists owned Chrome user directories as resources. It is a cleanup/data-retention defect, not evidence that a still-running browser is falsely proved dead.

Reproduction is saved at `/tmp/browser-2d-audit-p3-p4-cleanup-probe.cjs`. Run `node /tmp/browser-2d-audit-p3-p4-cleanup-probe.cjs`. It reads the exact baseline with `git show`, transpiles the whole actual module in memory, and substitutes only imported dependencies. `fs.rm` throws EACCES; no filesystem deletion, DB opening or browser launch occurs. It tests both prepared and attached-with-confirmed-absent-process states.

Observed proof `/tmp/browser-2d-audit-p3-p4-cleanup-proof.json` has the same result for both states:

```
first = {kind:'resolved'}
second = {kind:'resolved'}
persisted state = {mode:'launch',phase:'released'}
events = ['save:released','rm:EACCES']
```

Missing acceptance cases are deletion refusal, interruption between browser exit and directory removal, interruption during partial removal, and retry after restart. A fix must preserve durable proof that the browser is already closed while keeping directory cleanup retryable. Merely moving `save(released)` after rm risks requiring discovery/PID evidence again after partial removal. Prepared/no-side-effect operations and already-released compatibility must remain idempotent. The coordinator owns implementation and regression verification.

### P3 severity, final-plan browser evidence label still names AdsPower

`docs/monorepo-refactor-plan.md:226` still requires `受控 AdsPower/浏览器场景及资源状态`. The phase row at `:263` and all P4 design/acceptance text correctly name Google Chrome. Replace the stale evidence label with controlled Google Chrome/browser scenarios so the final checklist cannot imply an excluded integration remains required. This is a documentation gap only.

## P3 coverage matrix

Every P3 exit condition in final-plan row 262 is expanded below with the design/acceptance commitments. PASS means source and corresponding existing tests/evidence agree, not a new full test execution in this slice.

| Criterion | Status | Implementation | Test/evidence |
| --- | --- | --- | --- |
| Durable acceptance before acknowledgment | PASS | work/repository.ts:86-126 transaction inserts queued run and immutable receipt together | worker/tests/storage.test.ts:79-112 reopens store and replays original receipt |
| Same command ID and input never duplicate acceptance | PASS | repository.ts:70-84, 86-89 returns stored result by canonical input | storage.test.ts:79-112 tests repeats across restart |
| Same ID with changed kind/input conflicts, refusals remain stable | PASS | repository.ts:70-78 canonical input includes command kind; refusal recorded at :124 | storage.test.ts:90-107 changed device/kind and durable not-found |
| Response loss uses original command lookup | PASS | repository.ts:242-256; public API getCommand, UI runs.ts:232-248 | storage.test.ts:108-112, UI Foundation.test.ts command retry/query tests |
| Same device never has concurrent nonterminal runs | PASS | repository.ts:93-100; 003-work.sql unique partial index work_active_device | storage.test.ts:114-145; resource-service.test.ts:275 cleanup blocks new run |
| Unresolved resources also reserve device identity | PASS | repository.ts:96; storage/business-store.ts:55-61 | storage.test.ts:228-250 and chrome-journal.test.ts:129-147 |
| Reserved device cannot be edited/deleted | PASS | business-store.ts deviceReserved guards update/delete | storage.test.ts:137-145 and :245-247 |
| Two executing devices maximum | PASS | repository.ts:25,159-169 union counts active/resource devices | storage.test.ts:168-201; chrome.test.ts:299-341 actual Chrome contexts |
| Four page units maximum, all-or-none reservation, queued task owns no execution capacity | PASS | repository.ts:159-200 sums unresolved pages and admits only complete demand | storage.test.ts:114-166 uses three-page jobs, only one resource; :168-201 limits devices |
| Oversized demand rejected durably | PASS | repository.ts:105-106,124 | storage.test.ts:183-199 rejection remains after settings change |
| Config revision/page count/viewport fixed at acceptance | PASS | repository.ts:102-117 stores config and private Chrome config atomically | storage.test.ts:147-157; chrome-journal.test.ts:47-77 |
| Queue cancellation does not create resources | PASS | repository.ts:151-157 queued becomes cancelled without admission | storage.test.ts:158-166; packaged probe main/index.ts:260-269 |
| Active cancellation first commits intent, then aborts execution | PASS | repository.cancel transaction :127-150; service.cancel :138-144 aborts only after return | storage.test.ts:203-226 late successful acquire is cleaned with zero executions |
| Timeout keeps capacity until abort-ignoring operation actually settles | PASS | service.ts:102-120 execution timer calls finish before abort; cleanup skips running entries :69 | storage.test.ts:320-346 checks no premature release |
| Intent recorded before external acquisition | PASS | repository.admit :181-199; service execute :82-85; controlled-driver.ts:60-90 | resource-service.test.ts:188-254 independently delayed create/response-loss/fencing |
| Late acquisition after cancel still recorded and cleaned | PASS | repository.acquired :202-212 preserves release-pending and refuses starting-to-running transition after stop | storage.test.ts:203-226; resource-service.test.ts:188-214 |
| Unknown acquisition is retained until final absence can be proved | PASS | adaptControlledDriver controlled-driver.ts:131-139 only accepts absent-final or explicit borrowed resource | resource-service.test.ts:215-255 independent service fences future creates |
| Borrowed resources preserved, unknown ownership blocks | PASS | controlled-driver.ts:106-122 verifies owner and skips borrowed deletion | storage.test.ts:293-318; resource-service.test.ts:256-274 |
| Cleanup failure remains stopping and visible with retained capacity | PASS for P3 controlled driver, P4 exception above | service.clean :46-65; repository.cleanupFailure :258-262 | storage.test.ts:228-250; :349-382 bounded timed-out retries; scheduler.spec.ts:189 |
| Every previous queued/starting/running/stopping becomes interrupted | PASS | repository.recover :264-272 invokes once before service wake at service.ts:44 | storage.test.ts:253-291 explicitly prepares all four states |
| Recovery never replays old work | PASS | recover changes states to interrupted; pump admits only queued, cleanup only reconciles obligations | storage.test.ts:269-283 executions zero; scheduler.spec.ts:105 and :287 |
| Full active/unresolved snapshot plus latest 100 terminal rows | PASS | repository.snapshot :281-308 query includes separate active, obligation and terminal sets | storage.test.ts:385 onward tests >100 active and old unresolved resource |
| Private ownership IDs remain out of public DTOs | PASS | repository.snapshot :298-307 constructs public resource projection | Chrome private config test chrome-journal.test.ts:47-77 |
| Single worker-owned business DB, no independent P1 scheduler | PASS | worker entry.ts:71-151 opens store and creates work service on returned same repository; private worker runtime boundary | Existing P3/P4 Electron foundation/business suites; no second scheduler source found |
| Ownership claim published before spawn, exact PID authorized before initialize | PASS | desktop worker-ownership.ts:36-82; worker-client.ts:29-36,84-100 | desktop/tests/worker-ownership.test.ts:70-85 |
| Concurrent hosts cannot authorize two writers | PASS | unique nonce records, atomic publish then foreign claim scan, read/recheck at worker-ownership.ts:48-69 | worker-ownership.test.ts:120-161 covers pending-to-authorized race and real concurrent hosts |
| Old live/unknown PID blocks takeover without signaling it | PASS | worker-ownership.ts:16-22,60-65 only ESRCH counts absent | worker-ownership.test.ts:95-111; scheduler.spec.ts:324 |
| Unauthorized child expires and heartbeats use owner nonce | PASS | worker entry.ts:32-36,65-68,239-242 lease; desktop worker-client.ts:101-103 | scheduler.spec.ts:147,324 |
| Shutdown stops admission, persists cancel, aborts, cleans, closes DB, observes process exit | PASS subject to P4 directory defect | service.stop :146-163; worker entry.ts:208-233; worker-client.close :194-250 | scheduler.spec.ts:251 uncooperative acquire/execute/release; foundation.spec.ts:140 |
| Cooperative 10s and force/exit-confirmation 5s, forced path never clean | PASS | worker entry.ts:209; worker-client.ts:200-246 uses exit Promise and throws forced status | scheduler.spec.ts:251-286; foundation.spec.ts:140 onward |
| Host loss cleans or exits nonzero, recovery remains conservative | PASS | entry watchdog and shutdown without request exits 1; ownership record released only actual exit | scheduler.spec.ts:147,287 and real PID checks |
| UI immediately sees unavailable, stale epoch/revision/generation cannot restore old connection | PASS | preload/index.ts:55-89; main/index.ts:375,420-430; ui/runs.ts:43-107 | UI Foundation.test.ts:185 onward, foundation.spec.ts unavailable checks |
| Subscription listener precedes initial refresh and disposal is available | PASS | preload/index.ts:189-195; ui/runs.ts:110-144 subscribes before refresh and returns disposer | Foundation.test.ts subscription/unmount tests; ui.spec.ts repeated-route listener checks |
| Development rebuild failure preserves existing process; successful replacement waits for clean exit | PASS | scripts/dev.mjs:30-68 builds before stop, checks zero exit; never launches replacement after failure | development-restart.spec.ts:108 and :142 |
| P2 schema/checksum/WAL upgrade preserves existing data and old claims | PASS | open-business-store migration path; immutable 001–003 SQL plus later 004 | business-storage.test.ts:73,174 and :328-490 |
| No material consumption, real history writes or business credential decryption for controlled work | PASS | controlled driver touches only explicit controlled resource root; Chrome controlled page implementation | chrome.test.ts:254-296 proves material/history snapshots unchanged; P3 acceptance states scope |
| Four target existing technical evidence | PASS historical, exact current product matrix pending root | .audit/p3-ci.json, .audit/p4-ci.json all four native jobs successful | P3/P4 acceptance disclose Windows Server vs Windows 11 and Fedora userspace limits |

P3's original 1s cleanup deadline was subsequently changed to the 7s Chrome cleanup policy. That original stage acceptance text is historical, not evidence of a current one-second guarantee. Source has a 30s execution deadline and 7s cleanup deadline. No issue is claimed merely for keeping dated P3 evidence.

## P4 coverage matrix

Every P4 final-plan row 263 exit condition and the more detailed P4 design commitments are covered here.

| Criterion | Status | Implementation | Test/evidence |
| --- | --- | --- | --- |
| Real puppeteer-core and local Chrome adapter | PASS | worker/browser/chrome-driver.ts imports puppeteer-core; worker production manifest includes it | P4 acceptance fixes 25.16.0 and real Chrome versions; chrome.test.ts real browser suite |
| Explicit executable or local installation discovery | PASS | browser/process.ts:9-41 validates configured executable and checks known candidates | chrome-journal.test.ts:79-108 missing executable before attempted launch; native CI supplies explicit Chrome |
| Owned launch uses app-exclusive profile, never user's default | PASS | chrome-driver.ts:55-56 derives root/operationId; launch :100-141 generates defaultArgs with userDataDir, random owner argument | browser.spec.ts:124-169 observes app-owned profile path and final emptiness |
| Loopback-only borrowed HTTP discovery, redirects refused | PASS | connection.ts:7-18,26-33 validates protocol/host/no credentials/path/query and fetch redirect:error | chrome-connection.test.ts and contract settings tests; chrome.test.ts:458 discovery cancellation |
| Freeze launch/connect settings and viewport per accepted run | PASS | repository.ts:102-117 stores private browser config; journal.config :30-35 | chrome-journal.test.ts:47-77; chrome.test.ts:299-341 queued run remains on old endpoint/viewport |
| Startup intent committed before browser spawn | PASS | Chrome journal.prepare before launch, save attempted at driver :114 immediately before spawnOwned | chrome-journal.test.ts:110-127 rejects replay, missing endpoint remains unknown |
| Real process handle retained before connection | PASS | process.spawnOwned :44-58; chrome-driver.ts:115-117 stores handle immediately | browser.spec.ts:96-179 spawned checkpoint/worker crash and cancellation |
| Owned identity verifies marker/profile/browser-instance/PID/process identity on same CDP connection | PASS | chrome-driver.verifyOwned :65-98; browserConnection returns current root, no transient target | chrome.test.ts:499-583 identity mismatch and :602 forged discovery; chrome-browser-connection.test.ts:52 |
| Disk PID never provides kill authorization | PASS | only live OwnedChild passed to stopOwnedChild; recovered path uses verified CDP Browser.close and observes PID absent | chrome-driver.ts:191-232; process.ts:92-103 |
| Browser exit must be observed before releasing browser obligation | PASS for process evidence | live child exit event or processAbsent verified; cleanupOwned :193-229 | chrome.test.ts:477-498 and :642; browser.spec.ts:168 actual process absence |
| Windows child survives worker death to permit ownership-checked recovery | PASS historical native Windows evidence | process.spawnOwned :49 detached on win32 | browser.spec.ts:153-156 explicitly asserts browser alive before replacement worker; P4 matrix Windows success |
| Borrowed task owns isolated disposeOnDetach context only | PASS | chrome-driver.borrow :146-178 saves creating intent then Target.createBrowserContext disposeOnDetach:true | chrome-browser-connection.test.ts:84; chrome.test.ts:254-296 |
| Borrowed context ID persisted before any pages | PASS | driver :160-165 saves known before second connection/context lookup; execute separately creates pages | browser.spec.ts:180-268 context-created crash deliberately precedes saved identity |
| Second connection operates within task context | PASS | driver :166-174 looks up exact saved context ID, execute uses active.context.newPage | chrome.test.ts:299-341 two isolated tasks, other default context untouched |
| Borrowed cleanup disposes exact context, verifies absence, preserves unrelated contexts | PASS | cleanupBorrowed :240-260 compares endpoint hash, disposes exact ID and re-queries | chrome.test.ts:254-296 default tab/cookie/localStorage; chrome-browser-connection.test.ts:84 disconnect ownership |
| Unknown borrowed creation outcome does not infer cleanup from auto-disposal | PASS | cleanupBorrowed rejects every state except known; journal phase creating retained | chrome-journal.test.ts:153-173; browser.spec.ts:180-268 context-created crash |
| Unknown launch outcome remains blocked, retains capacity and never automatically relaunches | PASS | acquire :269-270 rejects non-prepared; cleanupOwned needs owned handle or verified live identity | chrome-journal.test.ts:110-151 |
| Capacity is based on actual concurrent workload pages | PASS | inherited repository 2 devices/4 pages, execute :290-324 creates exactly accepted page count | chrome.test.ts:299-341, packaged observer historical maximumBrowsers=2 maximumPages=4 |
| Failure isolated to affected task | PASS | per-run abort/controller/context; page close/error aborts only pageAbort for that run | chrome.test.ts:342-367 closes one work page while second remains running |
| Real Chrome crash fails the run | PASS | execute disconnected events abort page operation and exception becomes failed | chrome.test.ts:584 kills actual owned Chrome and expects failed |
| Navigation timeout and cancel remove borrowed task context | PASS | signal passed through abortable and disconnectOnAbort; final cleanup explicit | chrome.test.ts:369-389 parametrized timeout/cancel on held local navigation |
| Cancellation while page target is unpublished | PASS | abortable newPage :292 and owner disconnection followed by context cleanup | chrome.test.ts:391-416 |
| Cancellation during owned startup | PASS | launch startup combines caller abort; actual child cleanup retains handle | browser.spec.ts:96-179 cancel-spawned |
| Controlled local workload prevents external target side effects | PASS | execute request interception :296-303 permits only about:blank/data/probeOrigin; default content is local | chrome.test.ts:418-456 external redirect explicitly ERR_BLOCKED_BY_CLIENT |
| Cleanup outcome alone releases service obligation | PASS contract, ISSUE concrete owned-profile implementation | service.ts:55-58, repository.resolved :223-229 | positive and blocked cleanup tests exist, but directory deletion fault missing; isolated probe above fails requirement |
| Owned profile directory deletion failures remain visible and retryable | ISSUE | driver.released :179-186 saves released before rm and swallows failure; :348 bypasses retries | `/tmp/browser-2d-audit-p3-p4-cleanup-proof.json` reproduces both prepared and attached cases |
| Worker crash startup/run/borrowed-context-create/cleanup leaves honest obligations | PASS subject to owned-directory crash gap above | journal state machine plus recover/cleanup only | browser.spec.ts:96 and :180 crash matrices; interrupted retained when borrowed identity lost |
| Old controlled obligations use controlled adapter | PASS | entry.ts:142-148 selects chrome only when chrome_run_configs has run ID | business-storage.test.ts:174 old v3 obligations unchanged |
| 004 only adds Chrome private journal/config and preserves earlier checksums | PASS | migrations/business/004-chrome.sql only creates two tables and sets version 4 | business-storage.test.ts:174; preceding migration checksum tests |
| Dormant legacy credentials do not block Chrome startup | PASS | openBusinessStore execution mode boundary and historical encrypted reference retained | business-storage.test.ts:174,649; Chrome settings E2E business.spec.ts:331 |
| Chrome config/private endpoint paths do not leak via work DTOs | PASS | runConfig DTO omits browser; browser config in private table; resource projection explicit | chrome-journal.test.ts:47-77 and chrome.test.ts:336-339 |
| No real user accounts/material purchases/subscriptions used | PASS | default local content, explicit controlled probe URL, no legacy execution function | chrome.test.ts:254-296 leaves business materials/history unchanged; final plan explicitly excludes old payment |
| Per-operation package checkpoints avoid timing-only acceptance | PASS | entry.ts:119-140 exact operation continue files; execute :325 pages-ready | browser.spec.ts:270 per-operation releases, cancellation and shutdown |
| Passive observer does not alter viewport | PASS existing real regression | connection.connect :55 defaultViewport:null and standalone observer | chrome-observer.test.mjs:14; P4 acceptance reports 1280x800 before/after |
| Browser root connection survives another client's transient target disappearing | PASS | connection.browserConnection :66-71 validates actual Connection instance | chrome-browser-connection.test.ts:52 real client disconnect reproduction |
| Four platform adapter/package evidence exists | PASS historical, exact current product matrix pending root | .audit/p4-ci.json per-step storage, Electron, distributables, external checkout runs, Fedora RPM | docs/implementation/p4-acceptance.md records final SHA, native counts and OS limitations |
| P0 behavior comparison distinguishes retained CRUD from excluded browser business | PASS with final-plan stale label note | final-plan row :263 and P4 design explicitly exclude old payments; chrome.test.ts business unchanged | docs/implementation/p0-baseline.md, P4 acceptance implementation/scope text and subsequent P5 route acceptance |

## Boundary and remaining gates

No independent new concurrency, device-exclusion, command-idempotence, cancellation-ordering, process-takeover or replay defect was found. This is a qualified source/test audit with the specific fault reproduction above, not a proof that every possible schedule was explored.

Signing, notarization, online update hosting and release are not P3/P4 blockers in the user's current scope. Windows Server runner does not prove Windows 11, Fedora userspace is not Fedora Wayland, and historical platform evidence is not silently relabeled as fresh current-SHA final release evidence.

Prove It Works changed this audit's choice of evidence. The report executes the actual baseline cleanup code with an injected deletion failure rather than trusting passing happy-path browser tests. The probe establishes an executable defect and leaves implementation to the coordinator.
