-- An Assignment's place in its lane: the order Dave wants a Driver's day done,
-- within its date and Driver (the Assignments with no Driver count as one
-- lane, Unassigned). Existing Assignments all start at 0, and ties are read
-- in the order they were added. Only adds; nothing is changed.

ALTER TABLE assignments ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
