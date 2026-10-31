# Independent review

The P6 runtime review by gpt-6-astra found stable generic-feed prerelease acceptance and Linux package detection trusting ambient APPIMAGE. Both were reproduced or traced through the pinned dependency and fixed. The actual pinned updater reproduction changes from returning 0.2.0-beta.1 to null. The updater suite includes the regression and system-package marker cases.

The P5 UI review by gpt-6.1-sol found a reconnect leaving an in-flight batch item marked sending. Reconnection now marks it unknown, retains the original command ID, permits query/retry and prevents an old dispatch finally block from changing a new session. A deferred-response component regression passes.

The release review by gpt-6-astra found missing Windows candidate resources, installation cleanup ownership recorded too late, and a staging path test accepting a descendant named ..staging. The candidate artifact now includes the complete Windows application, cleanup ownership is recorded before installation and containment compares path segments. The staging regression passes.

A fresh gpt-6-astra review approved those six fixes and found one integration failure. Builder imported release configuration across package boundaries. Shared release configuration now belongs to internal/build-config and builder consumes its declared export. No boundary rule was relaxed. The current boundary suite passes 36 tests.

Comment reviews found no executable comments or suppressions requiring removal. Deletions 0, MUST KILL 0, HOLD 0. Root self-review removed unused legacy generated Element Plus declarations together with obsolete entry points and preserved immutable migration SQL.

Formal signing, notarization, HTTPS trust, installed N-to-N+1, Windows 11 and actual legacy Squirrel migration evidence remain open. Unit doubles, loopback payload downloads and same-version preview reinstall are not substitutes for those results.
