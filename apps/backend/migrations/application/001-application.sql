CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
) STRICT;
CREATE TABLE browser (
  id INTEGER PRIMARY KEY AUTOINCREMENT CHECK (id BETWEEN 1 AND 9007199254740991),
  provider TEXT NOT NULL CHECK (provider = 'adspower'),
  profile_id TEXT NOT NULL,
  name TEXT NOT NULL,
  account TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL DEFAULT 0 CHECK (amount BETWEEN 0 AND 9007199254740991),
  count INTEGER NOT NULL DEFAULT 0 CHECK (count BETWEEN 0 AND 9007199254740991),
  status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'queued', 'starting', 'working', 'stopping', 'failed', 'recovery_required')),
  notes TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (provider, profile_id)
) STRICT;
CREATE TABLE card (
  id INTEGER PRIMARY KEY AUTOINCREMENT CHECK (id BETWEEN 1 AND 9007199254740991),
  number TEXT NOT NULL,
  expiry_month TEXT NOT NULL,
  expiry_year TEXT NOT NULL,
  security_code TEXT NOT NULL,
  cardholder_name TEXT NOT NULL DEFAULT '',
  billing_address TEXT NOT NULL DEFAULT '',
  billing_city TEXT NOT NULL DEFAULT '',
  billing_region TEXT NOT NULL DEFAULT '',
  billing_postal_code TEXT NOT NULL DEFAULT '',
  billing_country_code TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL DEFAULT 0 CHECK (amount BETWEEN 0 AND 9007199254740991),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'processed', 'failed')),
  extra TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  processing_id TEXT NOT NULL UNIQUE,
  last_result TEXT CHECK (last_result IS NULL OR json_valid(last_result)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (number, expiry_month, expiry_year)
) STRICT;
CREATE INDEX card_pending_asc ON card (status, created_at, id);
CREATE INDEX card_asc ON card (created_at, id);
CREATE TABLE settings (
  key TEXT PRIMARY KEY NOT NULL CHECK (key IN ('browser.apiBaseUrl', 'browser.apiKeyRef', 'work.maxConcurrentTasks', 'ui.sidebarCollapsed')),
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision BETWEEN 0 AND 9007199254740991),
  updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE work_task (
  id TEXT PRIMARY KEY NOT NULL,
  browser_id INTEGER NOT NULL UNIQUE REFERENCES browser (id),
  browser_snapshot TEXT NOT NULL CHECK (json_valid(browser_snapshot)),
  queue_order INTEGER NOT NULL UNIQUE CHECK (queue_order BETWEEN 0 AND 9007199254740991),
  state TEXT NOT NULL CHECK (state IN ('queued', 'starting', 'running', 'stopping', 'recovery_required')),
  stop_requested_at TEXT,
  execution_ref TEXT CHECK (execution_ref IS NULL OR json_valid(execution_ref)),
  environment_state TEXT NOT NULL CHECK (json_valid(environment_state)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE TABLE card_claim (
  card_id INTEGER PRIMARY KEY REFERENCES card (id),
  task_id TEXT NOT NULL UNIQUE REFERENCES work_task (id),
  claim_token TEXT NOT NULL UNIQUE,
  claimed_at TEXT NOT NULL
) STRICT;
CREATE TABLE card_operation (
  card_id INTEGER NOT NULL REFERENCES card (id) ON DELETE CASCADE,
  processing_id TEXT NOT NULL,
  operation_key TEXT NOT NULL,
  input_json TEXT NOT NULL CHECK (json_valid(input_json)),
  result_json TEXT NOT NULL CHECK (json_valid(result_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (processing_id, operation_key)
) STRICT;
