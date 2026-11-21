-- Send per day (GLOSSARY.md: Send, Draft, Changed, Added; ADR 0003).
-- day_sends: one row per Sent day, with the time it was first Sent. A day with
-- no row is a Draft; Sending again never changes the row.
-- assignment_changes: an Assignment's fields as they were before each change
-- made after its day was Sent (JSON, with the names of its entries then), so
-- the Driver can be shown what it was and later Trips can be matched to it.
-- Its rows are only ever added; they go only when their Assignment is deleted.
-- Only adds; nothing is changed.

CREATE TABLE day_sends (
  date TEXT PRIMARY KEY CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  sent_at TEXT NOT NULL
);

CREATE TABLE assignment_changes (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES assignments (id) ON DELETE CASCADE,
  changed_at TEXT NOT NULL,
  before TEXT NOT NULL CHECK (json_valid(before))
);

CREATE INDEX assignment_changes_by_assignment ON assignment_changes (assignment_id, changed_at);
