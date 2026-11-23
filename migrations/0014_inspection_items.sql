-- The Inspection checklist Dave keeps in Settings: one row per item ("Lights"),
-- in his own order (1 is first), optional or not. Like the other lists, items
-- are never deleted, only made inactive, and a label is unique ignoring case.
-- The starting items are reference data in seed/inspection-items.sql.
-- Only adds; nothing is changed.

CREATE TABLE inspection_items (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  optional INTEGER NOT NULL DEFAULT 0 CHECK (optional IN (0, 1)),
  sort_order INTEGER,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE UNIQUE INDEX inspection_items_by_label ON inspection_items (label COLLATE NOCASE);
