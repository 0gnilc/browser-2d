# Owned family contract review

The goal is to finish the current P0 through P6 engineering audit by correcting demonstrated cleanup defects while leaving the agreed formal-release gates separate. This independent review covers durable contract/data semantics and preservation of normal Windows behavior.

Verdict is PASS for the reviewed contract surface. No actionable correctness issue was found in the exact patch `b1b592f..6f7e4766caf27fb179dee4737dac7336116d04da`. This is not native Windows, POSIX writer-containment, four-target, packaging, or final engineering acceptance.

## Evidence reviewed

The checkout was `/tmp/browser-2d-audit-owned-family`, clean at `6f7e4766caf27fb179dee4737dac7336116d04da` before and after the probes. I read the accepted `.audit/p0-p6-family-design-synthesis.md`, `/tmp/browser-2d-family-design-judgment.md`, the original positive actor proof `.audit/p0-p6-audit-evidence/chrome-helper-recreation-proof.json`, the complete changed product modules and relevant tests. The prior actor proof attributes a successful profile-root recreation to an orphaned Chrome Helper. Its stated DTrace drops do not establish absence.

I applied Type System Discipline by checking the Zod-derived variants and the actual parse/save boundaries rather than treating a `stopped` phase name as lifetime evidence. I read the requested poteto-mode and TypeScript skills. No product files were edited, and no build, Electron launch, real Chrome launch, full suite, or subagent was run by this reviewer.

## Contract findings

- The schemas distinguish raw historical records from v2 attempted contracts, spawned/attached lifetimes, and stopped/released proofs. `ChromeState`, `OwnedLifetime`, and `StoppedProof` derive from these schemas. Database reads and writes parse their inputs. Evidence is in `apps/worker/src/browser/journal.ts:20-50,103-114` and `apps/worker/src/browser/process.ts:44-58`.
- Durable transitions cannot downgrade to unversioned state or change an already chosen family kind. Spawned-to-attached requires the identical lifetime and a matching main PID. Spawned/attached-to-stopped requires the corresponding proof kind and numeric identity. Stopped-to-released retains the identical proof. Attempted-to-stopped intentionally accepts a matching local drain proof after failed witness publication, or positive never-spawned evidence. Evidence is in `journal.ts:52-92,112-134`. Transition tests exercise both contract kinds, changed IDs, incompatible kinds, downgrade attempts, PID mismatch, and publication-failure transitions in `apps/worker/tests/chrome-journal.test.ts:363-476`.
- Startup retains the live child before the first await and before the spawned save. A failed spawned publication leaves attempted in storage but preserves the local capability. Cleanup uses that retained lifetime, rather than inferring non-spawn from the rejected acquisition. Evidence is in `apps/worker/src/browser/chrome-driver.ts:114-130,235-248` and the real-process regression source in `apps/worker/tests/chrome-family.test.ts:220-325`. I inspected but did not execute the Chrome regression.
- Raw unversioned prepared remains cleanable with never-spawned proof. Raw attempted, attached, and stopped remain uncertain without profile deletion or numeric signaling. Raw released remains terminal and historical. Evidence is in `chrome-driver.ts:232-234,391-394` and the reopened-database tests in `chrome-journal.test.ts:204-261`.
- New Windows attempts persist `windows-child` before spawn. Their successful spawn and cleanup use `windows-main-exited`, preserving the explicitly weaker child-only contract. `observeOwnedLifetime` refuses a kind originating from the other OS instead of guessing its meaning from the current host. Evidence is in `process.ts:45-58,67-104,106-132` and `chrome-driver.ts:114-130,249-278`. Durable stopped cleanup passes its recorded proof through unchanged, so a partial deletion retry does not upgrade Windows evidence into POSIX group emptiness. The selected retry tests exercise both proof kinds across a database reopen and assert no process observation, in `apps/worker/tests/chrome-profile-cleanup.test.ts:201-270`.
- The new runtime imports remain within the privileged worker package. The journal now imports schema values from the process module, which also imports Node and Puppeteer. This adds internal coupling but introduces no source cycle, public/UI privilege crossing, new package dependency, or observed type failure. The boundary checker and worker typecheck both passed.
- SQL migrations 001 through 004 are byte-identical between base and head. Matching Git blob IDs are `ae361f42be5c542d72bffe668b0b3f7a524643c9`, `8d1533bb813cd5c8f2778abf19ec3f44d3ff9b21`, `9267e6fcfde200dfabfc245d9545dcaa37cc7fba`, and `9c07a739e09087d789e6bd88763dbdc2778e7ead` respectively.

## Executed checks

Runtime was Node `v24.5.0` on Darwin x64.

- `pnpm exec vitest run --config vitest.config.ts tests/chrome-journal.test.ts tests/chrome-process.test.ts`, from `apps/worker`, passed 23 tests in two files.
- `pnpm exec vitest run --config vitest.config.ts tests/chrome-profile-cleanup.test.ts -t 'retries durable'`, from `apps/worker`, passed the two selected proof-retry tests. Four other tests were intentionally excluded.
- `pnpm exec tsc --noEmit -p apps/worker/tsconfig.json` passed.
- `node scripts/check-boundaries.mjs` passed.
- `git ls-tree` comparison established the four unchanged migration blobs. `git status --porcelain` remained empty.

The local Windows-shaped test records prove schema, transition, and retry behavior on this host. They do not prove native Windows process behavior. Native Windows normal completion, cancellation, cold recovery, borrowed-browser survival, bounded cleanup, and profile removal still need the parent's exact-head engineering matrix. This review supplies no universal Windows family-containment claim.
