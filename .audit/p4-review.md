# P4 independent review

Reviewed against P3 d4432f2 by gpt-6-astra and two gpt-6.1-sol agents. All used isolated worktrees. Root reproduced both accepted defects before fixing them.

- Browser process crash during the post-load workload could report completed. A real SIGKILL reproduced completed with zero resources. Browser and context-owner disconnect now reject execution. Permanent regression is in apps/worker/tests/chrome.test.ts.
- Settings accepted explicit local HTTP port 80 but runtime rejected URL.port after normalization. Root reproduced the validation error. Runtime validation now accepts default-port normalization. Regression is in apps/worker/tests/chrome-connection.test.ts.
- Cleanup Promise.race permitted overlapping fixture cleanup attempts. No unsafe Chrome write was demonstrated. Root removed the race and retained the underlying promise through settlement. The uncooperative-release Electron test passes.

Final independent gpt-6-astra review found no remaining actionable defect and reran the crash, forged-owned-discovery and default-port regressions successfully, 3 passed. It inspected the six Electron stage/crash cases. Root subsequently executed those six plus the uncooperative-release case, 7 passed.

The review requested explicit evidence for pre-attachment crash, lost borrowed-context creation response, launch cancellation, interrupted cleanup and ownership mismatch. Tests now cover these boundaries using isolated real Chrome processes, private worker test checkpoints, and a forged discovery file pointing to a separate test browser. Unknown context identity remains visibly unresolved even after Chrome auto-disposes the context.

Final reviewer attention flags concerned unrecorded Electron evidence and pending native packaging/matrix. These are verification gates, not asserted passes. The acceptance record and p4.tsv track their actual completion.

Comment audit found two redundant fallback comments, both removed. The observer comment describing Chrome exit during discovery remains, supported by actual packaged process lifecycles.
