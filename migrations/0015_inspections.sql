-- Inspections (GLOSSARY.md: Check-in, Inspection; ADR 0006): a Driver's
-- walk-around check of a Truck, item by item. The official record, so it is
-- append-only: a row is never changed or deleted, only followed by a newer one.
-- id: made by the phone (a UUID), so a retried Finish is recognised.
-- date: the Worker's US Eastern today when it was saved.
-- done_at: the Worker's clock at Finish, an exact UTC moment (ISO 8601).
-- A Driver's checked-in Truck for a day is his latest Inspection that day:
-- the newest done_at, ties broken by insertion order (rowid).
-- inspection_answers keeps each item's wording as it was (label), so renaming
-- an item never changes a past Inspection. Whether an Inspection needs repair
-- (any answer 'repair') is worked out from its answers, not stored.
-- Only adds; nothing is changed.

CREATE TABLE inspections (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  driver_id TEXT NOT NULL REFERENCES drivers (id),
  truck_id TEXT NOT NULL REFERENCES trucks (id),
  done_at TEXT NOT NULL,
  other_notes TEXT
);

-- Phase 3: whoever last inspected a Truck before a Trip.
CREATE INDEX inspections_by_truck ON inspections (truck_id, done_at);
-- Check-ins: each Driver's latest Inspection on a day.
CREATE INDEX inspections_by_driver ON inspections (driver_id, date);

CREATE TABLE inspection_answers (
  inspection_id TEXT NOT NULL REFERENCES inspections (id),
  position INTEGER NOT NULL,
  item_id TEXT NOT NULL REFERENCES inspection_items (id),
  label TEXT NOT NULL,
  answer TEXT NOT NULL CHECK (answer IN ('ok', 'repair', 'na')),
  repair_note TEXT,
  PRIMARY KEY (inspection_id, position)
);

-- The record holds whatever the Worker does: a change to either table fails.
CREATE TRIGGER inspections_are_never_changed BEFORE UPDATE ON inspections
BEGIN
  SELECT RAISE(ABORT, 'An Inspection is never changed.');
END;

CREATE TRIGGER inspection_answers_are_never_changed BEFORE UPDATE ON inspection_answers
BEGIN
  SELECT RAISE(ABORT, 'An Inspection is never changed.');
END;
