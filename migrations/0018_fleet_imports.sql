-- Fleet imports: each HCSS Fleet export Dave drops on the Fleet imports page
-- is one Import, and every visit it holds is kept once, per Truck.
-- fleet_imports: one row per Import. imported_at is the Worker's clock (UTC
-- ISO 8601); added, closed and unchanged count what it did to the stored
-- visits. format is the file Dave dropped: json or xlsx.
-- fleet_import_days: the US Eastern days (YYYY-MM-DD) each Import covered, so
-- a Truck's day knows its latest Import ("as of").
-- fleet_visits: one Truck's visit to one geofence. entered_minute is the entry
-- time in UTC cut to the minute (2026-11-16T19:43Z): the dedupe key, so the
-- JSON and xlsx rows of one visit meet. entered_at keeps the most exact entry
-- time any export gave; exited_at is NULL while the visit is open. import_id
-- is the Import that last changed it.
-- Only adds; nothing is changed.

CREATE TABLE fleet_imports (
  id TEXT PRIMARY KEY,
  truck_id TEXT NOT NULL REFERENCES trucks (id),
  file_name TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('json', 'xlsx')),
  imported_at TEXT NOT NULL,
  added INTEGER NOT NULL DEFAULT 0,
  closed INTEGER NOT NULL DEFAULT 0,
  unchanged INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE fleet_import_days (
  import_id TEXT NOT NULL REFERENCES fleet_imports (id),
  truck_id TEXT NOT NULL REFERENCES trucks (id),
  date TEXT NOT NULL,
  PRIMARY KEY (import_id, date)
);

-- A Truck's day: its latest Import.
CREATE INDEX fleet_import_days_by_truck ON fleet_import_days (truck_id, date);

CREATE TABLE fleet_visits (
  id TEXT PRIMARY KEY,
  truck_id TEXT NOT NULL REFERENCES trucks (id),
  geofence_code TEXT NOT NULL,
  entered_minute TEXT NOT NULL,
  entered_at TEXT NOT NULL,
  exited_at TEXT,
  entry_odometer REAL,
  exit_odometer REAL,
  import_id TEXT NOT NULL REFERENCES fleet_imports (id)
);

-- Each visit once; also a Truck's visits in entry order.
CREATE UNIQUE INDEX fleet_visits_once ON fleet_visits (truck_id, geofence_code, entered_minute);
CREATE INDEX fleet_visits_by_truck ON fleet_visits (truck_id, entered_at);
