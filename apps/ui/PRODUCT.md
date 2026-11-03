# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Vue renderer embedded in an Electron desktop application for Windows, macOS, and Linux.

## Product purpose

Browser 2D manages devices, materials, legacy business history, browser settings, and local browser verification tasks. The desktop application owns task lifetime. Closing it stops tasks and cleans up owned resources.

## Capabilities and constraints

### Tasks and runtime state

The executor verifies local pages through Chrome or local files. It does not consume business materials. The task table shows the current snapshot's recent runs. Its views and search filter that snapshot, which retains limited terminal records. The History page contains legacy business and material history, not a task-run archive.

New task opens a device-selection drawer. Search covers loaded device names and accounts. The header checkbox selects available devices in the current view. Selection survives search, reports total and visible counts, and can be cleared. Device refresh removes selections for records that no longer exist. The drawer also exposes local test-device creation. Task details show the run ID, state, configuration revision, page count, viewport, timestamps, and result.

Queued, starting, running, and stopping runs occupy their devices. Unresolved resources also block start, edit, and delete, including resources retained by terminal runs. Device data-status integers remain separate from runtime availability. Cancellation includes stopping and cleanup. Capacity remains occupied until cleanup completes. Owned and borrowed browser resources remain distinguishable. The UI does not provide manual force cleanup.

Runtime details, errors, command receipts, and batch outcomes remain accessible above each route. Accepted commands are not completed tasks. An unknown command can be queried or retried with the same command ID.

### Devices

The device page loads the complete device list. Search covers names, accounts, notes, and IDs. All, available, and occupied views use task and resource availability. Selection survives filtering and reconciles after refresh. Batch start and stop expose per-item receipts. A field selector controls optional columns, and density uses Element Plus table size variants.

Create and edit use a drawer with the existing device fields. Null text values remain null until changed, and amount conversion preserves zero and null. Device data-status numbers have no invented online or offline meanings.

### Materials

Card and status filters query the full dataset on the server. Draft filters become applied filters after a successful request. Views apply all, claimable status 0, or processing status 1. Reset, filter application, and page-size changes return to page 1. Page navigation retains the applied query. Page sizes are 20, 50, and 100. There is no global name search.

Tables show masked card numbers and never reveal the CVV. Enabling the CVV column still shows a mask. Full values remain available in the complete editor, including address fields, extra information, amount, status, device, and note. Updates send changed fields, preserve untouched null values, and preserve numeric zero. Processing rows cannot be edited, reset, or deleted. Editing cannot initiate processing status 1. Other stored status values keep their numeric labels.

Import has a separate guarded drawer. Submission commits valid records and then returns committed counts and original-line outcomes: inserted, invalid, duplicate, or blank. The report is a result of import, not a dry run. Reset and clear remain available with confirmation.

### Drafts and settings

Task selection, device editing, material editing, and import text use the shared guarded editor lifecycle. Dirty drafts require a discard decision before drawer closure, replacement, or route navigation. Close, Escape, backdrop, and cancel use that decision. Saving blocks departure. Failed saves retain the draft and visible errors.

The renderer registers a browser unload warning for dirty or saving drafts. This does not guarantee a prompt when the desktop window closes. Main-process cleanup and application exit remain authoritative.

History filtering, export, and clear remain accessible. Settings retain Chrome configuration, task-window configuration, revision checks, and application update controls.

## Brand commitments

The approved direction is an Airtable-inspired operational workspace with visible text and icon navigation, views, bordered tables, and focused drawers. The reference governs layout and flow, not pixel parity or custom control styling.

Use the existing Element Plus and Tailwind stack. Preserve Element Plus default control geometry, spacing, radii, and interactions. Theme controls through color variables only. The accent is purple, defined in DESIGN.md and src/style.css. Every data table uses ElTable with border. Business labels remain in Chinese. The sidebar keeps tasks, devices, materials, history, settings, and connection status accessible. An explicit toggle switches between labeled navigation and a 68px icon rail. The preference survives reloads when local storage is available. Collapsed icons and connection status expose labels on hover and keyboard focus.

## Evidence

Current routes and behavior live in src/ and tests/. The Electron bridge is defined by ../../packages/contracts. This record does not imply full business automation or production release readiness.
