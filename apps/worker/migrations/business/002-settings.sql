CREATE TABLE business_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL
);
CREATE TABLE business_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 0,
  secret_ref TEXT
);
INSERT INTO business_settings (id, revision, secret_ref) VALUES (1, 0, NULL);
CREATE INDEX material_pending ON material (status, create_time, id);
CREATE INDEX history_created ON history (create_time, id);
PRAGMA user_version = 2;
