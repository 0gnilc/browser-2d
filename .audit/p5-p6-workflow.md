# P5 and P6 workflow

The user wants the approved UI and developer experience completed, followed by release engineering. The user confirms signing, notarization and HTTPS feed resources are unavailable. Formal release acceptance stays open.

## Grounding

The renderer already uses TypeScript, public DTOs and a Pinia task snapshot. Business forms still mix native and Naive controls. Task commands live on the scheduler page. Source rebuild and CSS HMR are already tested. Root Forge/Vite/IDE files still reference retired entry points.

Desktop owns IPC origin checks and shutdown. Worker owns database and browser cleanup. The current shutdown function always exits; installer handoff must occur only after the same verified worker close, with no second writer or automatic install on quit.

## Units and acceptance

1. UI forms and task actions. Keep existing DTOs/database semantics; improve all five routes and app-level subscription lifetime. Verify component behavior and actual Electron navigation, import, pagination, confirmation, export, task actions and state continuity. Capture screenshots.
2. Development and cleanup. Remove retired entry points, update IDE command and watch shared TS settings. Prove Vue template and CSS HMR preserve worker PID and source rebuild closes predecessor before replacement.
3. Release design. Compare updater ownership sketches before implementation. Use a typed update state with no feed or installer paths supplied by renderer. Keep production and preview modes separate.
4. Release implementation. Add updater, bounded secure IPC, coordinated install, strict final-artifact evidence checks and publish from verified artifacts only. Check version/no-update/download failure and integrity against controlled feeds. Preserve application identity and data paths.
5. Integration. Run root checks, component/native/real Chrome/Electron tests, native four-target builds and copied-package checks. Independent reviewers assess correctness and evidence. Preserve all missing signed/install/update gates explicitly.

Throughput checkpoint: five UI routes, one shared task store, one update lifecycle, one release toolchain and four native targets. UI and release writers use isolated worktrees. Parent handles developer tooling and integration. No production upload or user-data migration is performed by this run.

Rubric for update design: shutdown safety; narrow validated public API; production configuration fail-closed; real-artifact verification; minimal ownership surface and testability.
