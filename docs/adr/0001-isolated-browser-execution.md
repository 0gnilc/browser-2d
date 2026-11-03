# Isolated Browser execution

Status: accepted.

## Context

A Browser can process successive Cards while another Browser continues independently. Stop must interrupt execution even when SQLite is busy. Uncertain process or provider state must prevent an unsafe replacement.

## Decision

Electron Main owns task supervision and platform session lifecycle. DataService is the sole SQLite owner. Each active Browser has a BrowserWorker utility process with its automation loop in a worker thread. Main closes the source gate before cancellation and retains ownership records until execution exit and exact session closure are proven.

DataService and BrowserWorker have separate compiled entry points. DataService cannot import automation or platform code. BrowserWorker cannot import database implementation or SQLite. The renderer uses public DTOs and named preload operations only.

## Consequences

Queued work does not create a worker. Stop preserves committed Card writes and stable operation receipts. Unknown forks and unresolved environment starts retain recovery reservations. Recovery does not relaunch work or turn a stored PID into kill authority. Source boundaries, actual process tests, and fused packaged tests enforce these decisions.
