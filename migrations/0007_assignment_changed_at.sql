-- When an Assignment last really changed: a field the Driver reads took a new
-- value, or it moved in its order (such as to another Driver's lane). Saving
-- the same values again, or shifting because a neighbour moved, leaves it.
-- Empty until the first change, so every existing Assignment starts empty.
-- Only adds; nothing is changed.

ALTER TABLE assignments ADD COLUMN changed_at TEXT;
