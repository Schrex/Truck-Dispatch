-- Materials (what is hauled) and Foremen (who the Driver reports to), and both
-- on an Assignment. Like the other lists, entries are never deleted, only made
-- inactive, and a name is unique within its list, ignoring case. Only adds;
-- nothing is changed.

CREATE TABLE materials (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE UNIQUE INDEX materials_by_name ON materials (name COLLATE NOCASE);

CREATE TABLE foremen (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE UNIQUE INDEX foremen_by_name ON foremen (name COLLATE NOCASE);

ALTER TABLE assignments ADD COLUMN material_id TEXT REFERENCES materials (id);
ALTER TABLE assignments ADD COLUMN foreman_id TEXT REFERENCES foremen (id);
