-- Assign each Assignment on its own, replacing Send per day (GLOSSARY.md:
-- Assign, Draft, Added; ADR 0005).
-- assigned_at: when Dave Assigned the Assignment; empty while it is a Draft.
-- handed_from: on the copy made by giving an Assigned Assignment straight to
-- another Driver, the id of the Assignment it was handed over from (so the
-- copy is Added); empty on every other Assignment.
-- Carried over from Send per day: on each day already Sent, every Assignment
-- with a Driver is Assigned when its day was first Sent, or when it was made
-- if that was later. Everything else stays a Draft. day_sends is kept, but no
-- longer read.

ALTER TABLE assignments ADD COLUMN assigned_at TEXT;
ALTER TABLE assignments ADD COLUMN handed_from TEXT;

UPDATE assignments
   SET assigned_at = (SELECT MAX(s.sent_at, assignments.created_at) FROM day_sends s WHERE s.date = assignments.date)
 WHERE driver_id IS NOT NULL AND date IN (SELECT date FROM day_sends);
