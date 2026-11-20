-- Assignments: one piece of work given to one Driver for one day (GLOSSARY.md).
-- One row each, with a stable id, so GPS trips and tickets can link to it later.
-- Only the date is required. Truck, Places, Material and Foreman are added by
-- later migrations. The old orders table is left in place, unused.

CREATE TABLE assignments (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  driver_id TEXT REFERENCES drivers (id),
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX assignments_by_date ON assignments (date);
