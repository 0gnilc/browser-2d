CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  commandId TEXT NOT NULL UNIQUE,
  deviceId TEXT NOT NULL,
  durationMs INTEGER NOT NULL CHECK (durationMs BETWEEN 100 AND 30000),
  state TEXT NOT NULL CHECK (state IN ('running', 'completed', 'cancelled', 'interrupted')),
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE UNIQUE INDEX one_active_run_per_device ON runs(deviceId) WHERE state = 'running';
PRAGMA user_version = 1;
