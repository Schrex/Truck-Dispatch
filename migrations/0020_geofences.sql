-- Geofences (Settings): every geofence code the app knows, each with Dave's
-- Not considered toggle. The Trip builder skips a visit to a code turned off
-- (not_considered = 1), however long the Truck stayed. A code is unique,
-- ignoring case. Filled by every Import (a new code comes in considered) and,
-- once, from HCSS's Location list on staging (not in the repo).
-- This replaces the Not considered list of 0019: its codes in use come over
-- turned off, and the table is left unused. Every code already in a stored
-- visit comes over considered.
-- Only adds; nothing is changed.

CREATE TABLE geofences (
  code TEXT PRIMARY KEY COLLATE NOCASE,
  not_considered INTEGER NOT NULL DEFAULT 0 CHECK (not_considered IN (0, 1))
);

INSERT OR IGNORE INTO geofences (code, not_considered)
  SELECT trim(code), 1 FROM not_considered WHERE active = 1 AND trim(code) <> '';

INSERT OR IGNORE INTO geofences (code)
  SELECT DISTINCT trim(geofence_code) FROM fleet_visits WHERE trim(geofence_code) <> '';
