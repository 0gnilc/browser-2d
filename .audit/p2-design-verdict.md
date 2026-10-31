# P2 independent design verdict

Use **B as the base**, graft A's expected settings revision and C's incremental adoption of legacy tables, and resolve startup/session behavior as below before implementation. All three candidates fit P2 substantially better than a new storage abstraction or schema rewrite. None is implementation evidence.

The judge read all three candidates, `.audit/p2-grounding.md`, the binding phase plan, current worker startup/client code, and boundary checker. Parent model family is unknown, so a cross-family independence check could not run. This review performed no migration or Electron execution; the candidates' reported SQLite probe remains coordinator-supplied evidence requiring checked-in reproduction.

## Scores (1–5)

| Candidate | Migration / crash recovery | Credential boundary / atomicity | Small maintainable API | P2 scope | Executable verification | Total |
|---|---:|---:|---:|---:|---:|---:|
| A | 4 | 4 | 4 | 5 | 4 | 21 |
| B | 4 | 4 | 5 | 5 | 4 | 22 |
| C | 4 | 3 | 4 | 5 | 4 | 20 |

A has the clearest concurrency protection for settings and sensible per-domain storage modules. Its asynchronous callback inside store opening is less explicit than B's unusable-until-finished capability. A also omits B/C's explicit persisted-reference verification on every restart.

B makes partial initialization unreachable to business handlers, isolates the legacy secret exception, and concentrates the essential invariants. Its missing expected revision and ambiguous transition from an existing persistent key into session mode must be corrected. The single business module is acceptable initially; split domain statement groups only when the implementation warrants it.

C's physical-schema adoption is the safest migration choice. Its session override leaves the durable reference untouched and restores the old key on restart; that surprises callers of an operation named replacement and differs from A/B. Its `needs-session-consent` initialization outcome also conflates two separate cases: a fresh session key is allowed, but session storage cannot complete legacy plaintext migration.

Every candidate currently overstates what SQLite exclusivity establishes about an old process. Their test proposals are good but not yet executable artifacts, which limits verification scores.

## Selected design and grafts

1. Keep B's private owned connection and one-use paused bootstrap continuation. Only a ready store exposes synchronous domain operations; asynchronous vault/backup work stays outside SQL transactions.
2. Add A's `expectedRevision` to every settings save, returned by settings get/save. Serialize the entire desktop settings choreography, not only vault writes. Check revision again in the worker transaction; stale saves return conflict and cannot change ordinary settings or the active key reference. Orphan ciphertext after a conflict is allowed.
3. Adopt C's legacy-table strategy: preserve tables, IDs, sequences, stored values, duplicates, timestamps, and separate history day/year; add only necessary metadata/reference tables and nonunique indexes. Derive new-write validation independently from permissive legacy read DTOs. Do not rebuild tables just to improve column names or constraints.
4. Keep B's startup verification of every durable referenced credential. A ciphertext file's existence does not establish that the active reference is readable.
5. Keep C's unchanged-duplicate-tuple update rule and null-safe tuple equality. Preserve old duplicate rows while rejecting newly introduced duplicate tuples transactionally. Existing duplicates must remain editable in unrelated fields.
6. Preserve named public operations and delete each migrated legacy CRUD route, preload capability, handler and repository after its callers move. Do not add browser execution, scheduler recovery, generic reverse RPC, or a P5 redesign.

## Session credential semantics: resolve explicitly

Choose **replacement**, as A/B imply: selecting session mode replaces the configured key for this running application and removes the durable key reference. After full application restart, the key is missing. Do not silently resurrect an older persistent key as C proposes.

Main prepares an immutable session entry in memory first. The worker then synchronously commits nonsecret settings, revision increment and a null durable reference; its in-memory active selection points to the prepared session reference. SQL never stores a session reference. Main already has the entry before the worker can acknowledge success. Failure before the DB commit preserves the prior selection/reference. After commit and acknowledgement loss, reading settings resolves the result; retrying the stale revision conflicts. A process crash can lose the selected session key, which is the advertised session behavior.

Main holds the plaintext session value; the worker needs only its opaque runtime selection in P2. A secret snapshot for actual task execution belongs to P3/P4. `retain` preserves whichever selection is active, including session mode; `clear` commits null and removes the active selection; persistent replacement commits only after verified vault publication. Retain old vault entries and session entries until no pending operation can reference them; defer durable garbage collection.

Legacy plaintext migration still requires secure persistent storage and read verification. An insecure backend yields a blocked migration with a nonsensitive remediation message. Do not offer session mode as a way to bypass that migration requirement. Fresh or already migrated databases may offer an explicit session choice when entering a key through settings. Avoid a universal startup session prompt.

## Readiness and ownership protocol

Use distinct typed states: `starting`, `awaiting-migration-consent`, `opening`, `awaiting-credential`, `ready`, `blocked`, `closing`. Credential requests discriminate `legacy-transfer` from `verify-reference` and include a fresh worker-instance nonce and one-use correlation token. Renderer IPC cannot construct either private variant. Duplicate, stale and wrong-state replies fail with fixed codes.

Current `apps/desktop/src/main/index.ts` awaits `worker.ready` before creating its BrowserWindow. Therefore a renderer prompt during initialization would deadlock. For the smallest P2 change, use a native desktop confirmation for an existing legacy migration, or intentionally create a restricted shell before waiting; do not implicitly rely on the current window being present. A native dialog is the smaller choice. Gate business requests in both desktop and worker until final readiness; emitting a synthetic snapshot must not imply business readiness.

For existing legacy data, first identify the need for migration through the private bootstrap/preflight path and obtain explicit migration consent with confirmation that the old application has been closed. Consent alone is not a process probe. Preserve independently observed exit of any previously supervised worker; if its exit is uncertain, block replacement rather than launching another writer. For a separately installed legacy app, record the closure confirmation and any available positive process evidence honestly; a generic process-name scan cannot prove universal absence. Do not claim that a SQLite lock proves process termination.

Then acquire and retain actual SQLite exclusion, inspect the recognized schema, make the validated WAL-aware backup, prepare/verify credentials if required, commit the full schema/ledger/reference/plaintext-removal transaction, and finally emit business-ready. An idle old app can remain alive while SQLite excludes it; this is why the process/consent gate and database gate are separate. If old-process termination cannot be established to the binding plan's required standard, remain blocked even if the DB lock succeeds.

The paused credential continuation owns the connection and must have an explicit close/cancel path. Shutdown during backup, a native prompt, or credential preparation must cancel readiness, close the connection when safe, and wait for worker exit. Late preparation may leave an orphan vault record but must never revive initialization. Replace the current one-shot 15-second startup timeout with bounded machine-work stages that do not expire while awaiting explicit user input. Keep timeout/cancellation behavior testable rather than allowing an unbounded startup promise.

Existing fatal handling forwards `error.message`; replace that path for initialization and business failures with curated codes/messages. Never send raw parser issues or arbitrary exceptions from a secret-bearing protocol. Main's current ready handler also lacks an explicit failed/closing-state rejection, so late ready events must be ignored or rejected structurally.

## Minimum executable gates

- Reproduce the exact retained-exclusive-lock plus same-source-connection backup probe using pinned SQLite bindings. Include committed WAL-only data, a pre-opened idle contender, an active contender, and a still-running legacy process after successful lock acquisition. The final case proves exclusion and disproves termination inference. Check access remains blocked until owner close.
- Verify unknown/higher/checksum-altered schemas refuse application changes, backup integrity and retained paths, statement-by-statement rollback, and exact legacy rows/sequences/export bytes. Be precise about no-writes assertions: SQLite opening or journal recovery can affect sidecars; the essential claim is no incompatible schema/data mutation, with physical file invariance tested only where the fixture supports it.
- Fault-inject vault write/flush/rename/decrypt verification, SQL commit, reply loss and process exit. Assert every durable committed reference remains decryptable; failures preserve prior references; no new secret plaintext reaches DB, files, public responses, errors or logs. Classify the preserved legacy backup separately.
- Exercise concurrent settings saves with the same expected revision, persistent-to-session replacement followed by restart, retain while in session mode, clear, worker exit during preparation, late bootstrap response and replayed token.
- Verify each slice through real Electron IPC, transaction, UI refresh and restart. Test forged renderer sender and bootstrap messages. Record real safeStorage evidence separately from fake unavailable/basic_text tests and from untested platforms.
- Extend boundary checking to contracts and the complete production dependency graph, with negative fixtures for public-to-host imports, bare Node builtins, side-effect/dynamic imports, desktop SQLite access, cycles, and cross-app source edges. Current checker iterates only app source and regex-matched imports.

## How the resulting system works

The UI talks only to named public business methods. Preload carries those methods to desktop, which authenticates the renderer and routes private typed requests to its supervised worker. The worker owns business rules, transactions and the separate business database; its existing synthetic database stays independent. A successful mutation returns its committed result, after which the UI refreshes through the same public API.

Settings deliberately cross two owners. Desktop prepares and verifies encrypted storage, then the worker atomically switches its opaque reference with ordinary settings. Keeping earlier encrypted records makes a failure between those commits recoverable. At startup the worker pauses until backup/migration and any necessary credential verification finish, so no caller can observe a half-migrated store. Desktop owns process lifetime and encryption; the worker alone owns business SQLite. That is the essential seam to preserve through P2.
