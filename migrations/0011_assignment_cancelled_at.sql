-- When an Assignment was cancelled: ✕ on a Sent day keeps the Assignment, so
-- the Driver who has seen it is told it is off his day ("Cancelled by Dave")
-- and the trip log can later explain why it has no Trips. Put back empties it.
-- Empty for every Assignment that is not cancelled, so every existing one starts empty.
-- Only adds; nothing is changed.

ALTER TABLE assignments ADD COLUMN cancelled_at TEXT;
