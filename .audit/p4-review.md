# P4 independent review

Reviewed against P3 d4432f2 by gpt-6-astra and two gpt-6.1-sol agents. All used isolated worktrees. Root reproduced both accepted defects before fixing them.

- Browser process crash during the post-load workload could report completed. A real SIGKILL reproduced completed with zero resources. Browser and context-owner disconnect now reject execution. Permanent regression is in apps/worker/tests/chrome.test.ts.
- Settings accepted explicit local HTTP port 80 but runtime rejected URL.port after normalization. Root reproduced the validation error. Runtime validation now accepts default-port normalization. Regression is in apps/worker/tests/chrome-connection.test.ts.
- Cleanup Promise.race permitted overlapping fixture cleanup attempts. No unsafe Chrome write was demonstrated. Root removed the race and retained the underlying promise through settlement. The uncooperative-release Electron test passes.

Final independent gpt-6-astra review found no remaining actionable defect and reran the crash, forged-owned-discovery and default-port regressions successfully, 3 passed. It inspected the six Electron stage/crash cases. Root subsequently executed those six plus the uncooperative-release case, 7 passed.

The review requested explicit evidence for pre-attachment crash, lost borrowed-context creation response, launch cancellation, interrupted cleanup and ownership mismatch. Tests now cover these boundaries using isolated real Chrome processes, private worker test checkpoints, and a forged discovery file pointing to a separate test browser. Unknown context identity remains visibly unresolved even after Chrome auto-disposes the context.

Final reviewer attention flags concerned unrecorded Electron evidence and pending native packaging/matrix. These are verification gates, not asserted passes. The acceptance record and p4.tsv track their actual completion.

Comment audit found two redundant fallback comments, both removed. The observer comment describing Chrome exit during discovery remains, supported by actual packaged process lifecycles.

## Native matrix corrections

The first matrix exposed a Windows-only test path assertion and a macOS Chrome installation layout defect. The path assertion now compares the exact parent of DevToolsActivePort with node:path. CI restores the .app suffix removed by setup-chrome's channel cache. Identical Chrome for Testing 156.0.8078.80 binaries failed with helper IPC and Network.enable timeouts under an extensionless directory, then passed local navigation and all 11 existing Chrome tests after restoring the bundle layout. No production browser flags were changed.

The Linux cancellation gate exposed a Puppeteer target-publication race. A real Chrome regression cancels after Target.createTarget and before waitForTarget subscribes. Before the fix it remained stopping after two seconds. Page operations now use the existing abortable boundary, and resource cleanup still proves context or browser removal. The already-aborted helper regression also reproduced a synchronous throw plus an unhandled late command rejection; the helper now always attaches pending handlers before rejecting cancellation. The corrected Chrome and connection suites contain 14 tests.

## Deferred native acceptance

Final runtime matrix 41168987583 passed both macOS targets. Windows and Linux passed code, browser, Electron and distribution builds, then failed copied-package verification. The prior generic startup error does not identify the failing assertion, so no native fix is claimed. Failure-stage and pre-assert observation artifacts were added for the next diagnostic run.

Diagnostic run 41170041659 never started a job. GitHub reported failed account payments or a spending-limit requirement. The user explicitly chose not to address it now and to retain unfinished acceptance items. No further remote runs are authorized in this handback. Issue #5 remains open.

The final cold-recovery follow-up was independently reviewed by gpt-6.1-sol. Its real-Chrome regression proved that an already exited, previously verified browser can be resolved by PID absence without a live child handle. Attempted launches and live/reused PIDs remain protected. Three related ownership regressions passed.

## Acceptance closure after repository became public

The resumed native diagnostic identified `Target.attachToTarget: No target with given id found` in owned-browser verification. Real Chrome confirmed that a client can cache another client's transient browser target. Disconnecting that owner breaks target attachment while commands on the original root connection still succeed. The runtime and observer now use a guarded root Connection. The exact Puppeteer version remains pinned; its internal getter is confined to the adapter. Independent review confirmed all ownership checks remain intact and two real Chrome identity/disposal tests pass.

Two separately reproduced verifier defects were corrected. Observer attachment changed real page dimensions; defaultViewport:null now preserves them. A four-second staggered Chrome launch caused the three-second workload to finish before concurrent observation; a private pages-ready checkpoint now holds each operation until the verifier releases the sole survivor. Shutdown work remains held until desktop close. Production duration and public IPC are unchanged. Independent verifier review approved the change and reran the real viewport regression.

Root integration passed 59 worker tests, one observer test, all static/boundary checks, and 27 Electron tests. Corrected Linux diagnostic run 41174187218 passed five complete dual-launch package verifications. Final all-platform acceptance remains separately recorded in p4-ci.json.

## Final acceptance verdict

Final matrix 41175541889 passed all four native targets on source4c9706e9654d138c7a72a577f4f70a39a89e51f4. It includes the observer regression, 59 worker tests, native Electron suites, two copied-package runs per target and installed Fedora RPM checks. The Windows test-file isolation change does not alter product concurrency, assertions or timeouts; its two-run native probe passed59 tests twice before the final matrix.

The independent verifier review and root-channel review found no remaining actionable code findings. Their noted native acceptance gate is now satisfied. The scoped internal Puppeteer getter remains intentionally coupled to the exact pinned version and guarded by real Chrome identity/disposal tests.

The public repository restored Actions execution. PR creation was attempted again through the required built-in connector, which returned403 Resource not accessible by integration. No PR was created and main was not merged. This is a delivery-tool permission limitation, not an open P4 acceptance gate.
