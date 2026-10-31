# P0–P6 completion audit

The user asks for a full check against the accepted reconstruction plan and completion of engineering and acceptance work possible with current resources. Signing, notarization, a trusted update feed and formal publication remain deferred.

Baseline is ee6b87d447d99a8e7b0b30c245e7c346c58a1905. The implementation validated by the previous four-target native matrix is f52238f4e54117649cfeee710ed336d0724dba67. The difference is documentation and archived evidence.

Done means every P0–P6 exit criterion has a source and test or native artifact evidence, each reproduced actionable gap is fixed and verified, and remaining criteria have an explicit reason rather than a pass. No real user database, browser profile, account or purchase target participates.

The audit has seven phases and four native build targets. Three read-only workers inspect separate phase slices. The coordinator checks root commands and evidence, owns edits, and sequences runtime suites to prevent shared build and Electron output races. Review rigor is high because database ownership, shutdown and distributable applications cross process and platform boundaries. Settled architecture is retained unless a reproduced defect requires a change.

1. Read the plan, phase reports, source boundaries and issue state. Build a criterion matrix.
2. Run the existing verification entry points and independently inspect archived native evidence.
3. Reproduce each suspected gap against observable behavior. Keep only demonstrated findings.
4. Fix one unit, run its focused check, and record the result before the next unit.
5. Run the complete local verification. Rebuild and verify affected native artifacts where code or verifier changes require it.
6. Obtain independent source and evidence review. Resolve accepted findings.
7. Update the phase matrix, evidence and tracker. Retain formal release gates. Commit and prepare a reviewable branch.

The throughput checkpoint is after the three source reviews and baseline verification. It decides which proven gaps need code, which need repeatable evidence, and which remain deferred by the user.
