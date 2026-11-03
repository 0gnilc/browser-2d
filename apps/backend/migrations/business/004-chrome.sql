CREATE TABLE chrome_run_configs (
  run_id TEXT PRIMARY KEY REFERENCES work_runs(id),
  config TEXT NOT NULL
);
CREATE TABLE chrome_operations (
  operation_id TEXT PRIMARY KEY REFERENCES work_resources(operation_id),
  state TEXT NOT NULL
);
PRAGMA user_version = 4;
