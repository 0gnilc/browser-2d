# Chrome design cross-judgment

The goal is direct Chrome execution with durable cleanup and preservation of existing local data.
Choose B's explicit spawn boundary, with the corrections and grafts below.

| Candidate | Correctness / ownership | Interface simplicity | Migration safety | Executable verification |
| --- | ---: | ---: | ---: | ---: |
| A | 5 | 4 | 5 | 4 |
| B | 3 | 4 | 4 | 4 |
| C | 4 | 4 | 5 | 4 |

Scores judge the written candidates, before synthesis. Verification is a proposed plan except for the supplied context probe.
A best distinguishes process absence from a lost connection and records the launch uncertainty.
B exposes the process handle earliest but leaves browser closure and recovered context identity underspecified.
C best removes active AdsPower configuration without deleting compatibility data.

The proposed synthesis is coherent subject to these explicit requirements.

1. Generate Chrome arguments with `puppeteer.defaultArgs`, then add the unique owner switch, private user-data directory and loopback debugging configuration without conflicting duplicates. Spawn the resolved executable without a shell. Keep the child handle and exit observation for the entire resource lifetime. Explicit spawn exposes that handle before attachment; it does not remove the crash window between the durable attempted checkpoint and spawning.
2. Graft A's durable `prepared -> attempted -> attached -> released` launch journal. Commit attempted before spawn. An attempted operation never spawns again on retry. Prepared proves no launch was attempted. Missing discovery files, launch timeout and refused CDP after attempted remain unknown. Late attachment after cancellation proceeds only to cleanup.
3. Validate exact owner switch and exact private user-data directory on the connected browser before any owned close. If an attached browser UUID was persisted, require it to match as well. A matching directory or port alone grants no ownership. Never follow an endpoint occupant with another identity.
4. Final owned cleanup requires positive process-exit evidence. Retain live child exit evidence. Recovery may use a PID obtained from the verified browser only after matching its exact command-line marker, user-data directory and process birth identity; observe that same process identity exiting. A persisted PID, disappearing WebSocket or successful Browser.close response alone is insufficient. If equivalent exit evidence is unavailable, remain blocked and retain capacity and profile files.
5. Replace generic reconcile/release interpretation with explicit acquire, execute and cleanup results. Cleanup returns only `released` or `unknown` with a reason. Only released retires the obligation and capacity reservation. A borrowed browser being present must never count as successful cleanup. Keep resource handles and recovery state private to the driver/repository boundary.
6. Borrow through a dedicated CDP owner connection and `Target.createBrowserContext({disposeOnDetach:true})`. Persist original browser UUID and returned context ID before opening pages. Connect Puppeteer to that exact browser and select only that context. Verify original UUID before disposing or checking absence during recovery. Explicitly dispose the context, disconnect owner/client connections, and verify its absence on the original browser. Preserve the sentinel/default context and never close the borrowed browser.
7. A lost context-creation result, missing ownership record, unavailable original browser, changed UUID or ambiguous cleanup remains unknown. Detach disposal helps contain the lost-result window, but the probe does not prove crash recovery or durable absence. Do not turn a timeout into final absence.
8. Graft C's active-surface removal. Remove AdsPower fields, key controls, credential status and secret mutation from current settings/execution contracts. Preserve legacy encrypted bytes, references, migration checksums and the actual legacy import path. Dormant credentials do not gate Chrome startup. Freeze private Chrome config at run admission, retain revision/dimensions, and add a forward migration. Classify old fixture obligations explicitly. No credential IPC is needed.

The probe supports context discovery from a second Puppeteer connection, readable owner markers and context disposal after orderly owner disconnect. It does not establish SIGKILL cleanup, process-exit recovery, endpoint replacement safety or scheduler behavior.

Required executable checks cover owned exit and borrowed sentinel survival, two-device/four-page limits, isolated page failures, cancellation during launch/navigation/cleanup, worker SIGKILL after spawn and before context-ID persistence, lost acquire results, cleanup retries, exact marker/UUID mismatch, endpoint reuse and retained capacity for unknown outcomes. Also verify frozen config, private endpoint/path exclusion from public DTOs and unchanged legacy vault bytes. These checks must inspect real Chrome processes/contexts, not only service state.

Proceed with this synthesis. Do not claim recovery complete until process-exit evidence and ambiguous-result tests run against installed Chrome.
