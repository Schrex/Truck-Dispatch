-- Jobs, Places, and the From and To Place on an Assignment.
-- Like the other lists, entries are never deleted: one is made inactive
-- instead. A Job's name and a Place's short name are unique within their list,
-- ignoring case. geofence_code is for matching GPS later; nothing shows or
-- edits it yet. Only adds; nothing is changed.

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  job_number TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE UNIQUE INDEX jobs_by_name ON jobs (name COLLATE NOCASE);

CREATE TABLE places (
  id TEXT PRIMARY KEY,
  short_name TEXT NOT NULL,
  full_name TEXT,
  kind TEXT CHECK (kind IN ('plant', 'job_site', 'shop', 'yard')),
  job_id TEXT REFERENCES jobs (id),
  geofence_code TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE UNIQUE INDEX places_by_short_name ON places (short_name COLLATE NOCASE);

ALTER TABLE assignments ADD COLUMN from_place_id TEXT REFERENCES places (id);
ALTER TABLE assignments ADD COLUMN to_place_id TEXT REFERENCES places (id);
