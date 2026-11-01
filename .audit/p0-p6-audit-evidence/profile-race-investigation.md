# Profile cleanup diagnosis

Baseline f966ba79db50786ef95d2661d6845107da06724e. Isolated frozen pnpm install. Native Intel macOS.

No natural recurrence or proven cause. Product unchanged.

- 20 unchanged target runs with Node 24.5.0 and installed Chrome 156.0.8078.74 passed.
- 20 unchanged target runs with Node 24.5.0 and Chrome for Testing 156.0.8078.80 passed.
- 3 unchanged full chrome.test.ts runs with Node 24.22.1 and Chrome for Testing 156.0.8078.80 passed all 39 tests.
- One synthetic leftover directory with diagnostic-probe.txt exercised failure-only diagnostics. Original empty-directory assertion failed as intended. This is instrumentation verification, not a reproduction of the CI cause. Temporary injection removed.

Logs remain under /tmp/browser-2d-profile-race-probes/. Synthetic JSON remains in this worktree artifacts/ and is identified by diagnostic-probe.txt. Diagnostic diff is /tmp/browser-2d-profile-race-diagnostics.patch.

The failure-only branch captures the original nonempty root listing, journal, observed browser PID, matching process PID/PPID/start-time/arguments, recursive entry names, sizes, modification times, and mode/type. It writes both console output and artifact JSON. The sampled assertion and 30-second test timeout are unchanged. No retries or product behavior changes.
