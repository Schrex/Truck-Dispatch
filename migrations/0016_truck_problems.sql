-- Truck problems (GLOSSARY.md: Truck problem): something wrong with a Truck,
-- reported by a Driver with a note, open until Dave marks it fixed. Kept
-- forever: a fixed one stays, with when (fixed_at) and how (fixed_note), so a
-- Truck's history is never lost. A Truck with an open problem can still be
-- checked in to and driven: the app reports, it never grounds.
-- id: made by the Worker.
-- reported_by_driver_id: the reporting Driver. Nullable here, though the
-- Worker requires one for now, so "Dave adds a problem" later needs no table
-- rebuild (an add-only migration cannot relax NOT NULL).
-- reported_at, fixed_at: the Worker's clock, exact UTC moments (ISO 8601).
-- inspection_id: the Inspection it came from (a Needs repair item), if any;
-- it is created in the same batch as that Inspection.
-- Only adds; nothing is changed.

CREATE TABLE truck_problems (
  id TEXT PRIMARY KEY,
  truck_id TEXT NOT NULL REFERENCES trucks (id),
  reported_by_driver_id TEXT REFERENCES drivers (id),
  reported_at TEXT NOT NULL,
  text TEXT NOT NULL CHECK (length(trim(text)) > 0),
  inspection_id TEXT REFERENCES inspections (id),
  fixed_at TEXT,
  fixed_note TEXT
);

-- The list: open ones (fixed_at NULL) first, and one Truck's open ones.
CREATE INDEX truck_problems_by_truck ON truck_problems (truck_id, fixed_at);
-- An Inspection's answer: the problems it opened.
CREATE INDEX truck_problems_by_inspection ON truck_problems (inspection_id);
