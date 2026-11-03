# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Vue renderer embedded in the Browser 2D Electron desktop application for Windows, macOS, and Linux.

## Product purpose

Browser 2D manages local Browser records that reference existing AdsPower environments, independently imported Cards, and settings. Each active Browser has one WorkTask. WorkTasks temporarily claim Cards in import order. The desktop application owns execution and cleanup.

## Capabilities and constraints

### Browsers

The Browser page adds existing environment IDs and edits name, account, task amount, and notes. It shows backend status, completed Card count, and the latest error. Task input includes the full saved Browser snapshot. Queued, starting, working, stopping, and recovery states block edits, removal, and duplicate starts.

Start and stop are row actions. A pending request appears immediately. Idle is shown only after a backend read confirms it. Recovery offers another stop attempt. Removing a Browser deletes its local record and retains the platform environment.

### Cards

The Card page displays all user fields in plaintext, including raw Card number, expiry text, security code, address, extra text, notes, amount, state, latest verification result, and timestamps. Interior whitespace, hyphens, and leading zeros are preserved. Text is never interpreted as HTML. Filtering and pagination query the backend with createdAt and ID ascending order.

Cards are added only through a multiline textarea or UTF-8 TXT file. Both call cards.importText. The fixed eleven-column template is visible inside the import drawer. The first four fields are required. The importer reports committed counts and original line outcomes. A known partial report retains committed counts and unprocessed line information. A lost response is described as unknown progress. Input remains available for verification and retry.

Ordinary editing changes only changed input fields and local notes. Amount, status, result, and processing identities are not editable. Active claims block editing and deletion. The backend inputLocked projection protects fields with processing receipts while allowing notes only when unclaimed. Race responses retain the same protections. Deletion requires confirmation.

### Settings and drafts

Settings include the local API endpoint, explicit credential keep, replace, and clear actions, and maximum concurrent Browsers. The UI shows whether a credential is configured without exposing a credential reference. Replacement plaintext is cleared after an acknowledged save. The hidden aggregate revision participates in compare-and-swap saves. Conflicts preserve the draft.

Connection changes affecting saved environment bindings require a backend confirmation token and an explicit user confirmation. The UI resubmits the exact save with that token. Sidebar collapse is a typed setting. A successful local sidebar-only save advances the settings draft's baseline revision without discarding its unsaved form values. External changes are never silently merged over a draft.

Editing and import use a shared guarded lifecycle. Cancel, close, Escape, backdrop, replacement, and route changes arbitrate dirty drafts. Saving prevents departure and duplicate submissions. Failed saves retain inputs. Before-unload protection applies to dirty or saving drafts. The desktop host remains authoritative for window exit and task cleanup.

Application updates are manual. Unconfigured or unavailable services explain their state without claiming success. Standalone browser preview has no database, Node access, or successful simulated desktop operations.

## Brand commitments

The established Airtable-inspired workspace uses Element Plus controls and Tailwind layout. Purple color theming preserves default control geometry and interactions. Every data table has visible borders. The three routes are 浏览器, 卡, and 设置. A persistent sidebar toggle switches between text navigation and a 68px icon rail. Navigation and connection labels remain available to keyboard and pointer users in both states. Table overflow stays within the content area.

## Evidence

Source and component tests live in src/ and tests/. The public desktop API is defined by ../../packages/contracts/src/public. Component tests use test-only typed adapters. They do not establish native execution, real platform cleanup, or release readiness.
