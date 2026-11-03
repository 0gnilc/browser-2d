CREATE TABLE work_commands (
  command_id TEXT PRIMARY KEY,
  canonical_input TEXT NOT NULL,
  result TEXT NOT NULL
);
CREATE TABLE work_runs (
  id TEXT PRIMARY KEY,
  device_id INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued','starting','running','stopping','completed','cancelled','failed','interrupted')),
  config TEXT NOT NULL,
  outcome TEXT CHECK (outcome IN ('completed','cancelled','failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX work_active_device ON work_runs(device_id) WHERE state IN ('queued','starting','running','stopping');
CREATE TABLE work_resources (
  operation_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE REFERENCES work_runs(id),
  device_id INTEGER NOT NULL,
  owner_token TEXT NOT NULL,
  pages INTEGER NOT NULL CHECK (pages > 0),
  state TEXT NOT NULL CHECK (state IN ('intent','held','release-pending','resolved')),
  ownership TEXT NOT NULL CHECK (ownership IN ('unknown','owned','borrowed')),
  external_id TEXT,
  failure TEXT CHECK (failure IN ('ACQUISITION_UNCERTAIN','CLEANUP_FAILED','OWNERSHIP_UNCERTAIN'))
);
CREATE INDEX work_unresolved_device ON work_resources(device_id) WHERE state != 'resolved';
PRAGMA user_version = 3;
