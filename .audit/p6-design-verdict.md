# Update design verdict

Two independent sketches by gpt-6-astra and gpt-6.1-sol converged on a main-owned updater and a single application lifecycle. The alternatives considered were updater logic inline in main and a general worker/updater command bus. Both increase coupling or hide the shutdown ordering.

Independent judge gpt-6-astra selected candidate A, scoring 25/25 versus B 23/25 on shutdown safety, API boundary, production failure gates, real-artifact validation and ownership. Parent accepted A's revisioned state and B's explicit first-wins ExitIntent. Reserve install synchronously before acknowledging; subscribe before snapshot; reject older revisions; refuse install during ordinary quit; preserve observable install failure after worker closure.

The immutable resource is resources/release-config.json. Preview has mode only. Production adds channel stable/test, HTTPS feedBaseUrl without credentials/query/fragment and target win-x64/mac-x64/mac-arm64/linux-x64. Runtime derives the target/channel feed and ignores environment overrides. Preview updates remain disabled. Package identity and data paths remain frozen.

release:prepare produces an exact verified upload set and does not claim to publish. A remote release is not performed in this task. User explicitly confirms missing signing, notarization and feed resources, so genuine final signed/native N-to-N+1, install/uninstall and unknown Squirrel migration gates stay open.

Candidate artifacts were /tmp/browser-2d-p6-design-a.md and /tmp/browser-2d-p6-design-b.md. The accepted design is summarized here so the implementation does not depend on temporary files surviving.
