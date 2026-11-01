# Design rubric

Each criterion scores0–2. Evidence is the source-bound orphan-helper recreation, not a hypothetical failure.

1. Prevent profile deletion and resource release while a verified owned helper can still write, including main-gone cold recovery and pre-attachment cancellation.
2. Preserve ownership safety. Never signal an inherited group, an uncertain recovered identity, a stored PID or a borrowed browser. Bound waits with existing signals.
3. Define durable types and transitions, including safe handling of existing journal JSON and immutable business migrations.
4. State concrete Windows behavior and verification rather than claim POSIX primitives solve Windows or make normal Windows launch unavailable.
5. Keep the change concentrated in browser/process lifetime ownership, with the smallest useful interface and no new general supervisor or dependency without necessity.
6. Provide a deterministic real-process regression plus native namespace evidence that defeats the original teardown false pass.
