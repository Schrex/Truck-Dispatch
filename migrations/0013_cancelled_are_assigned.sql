-- A cancelled Assignment is always an Assigned one (ADR 0005): ✕ deletes a
-- Draft and cancels only what was Assigned. 0012 carried over only those with
-- a Driver, so an Unassigned one cancelled on a day already Sent was left a
-- cancelled Draft. Each such one is Assigned when its day was first Sent, or
-- when it was made if that was later.

UPDATE assignments
   SET assigned_at = (SELECT MAX(s.sent_at, assignments.created_at) FROM day_sends s WHERE s.date = assignments.date)
 WHERE assigned_at IS NULL AND cancelled_at IS NOT NULL AND date IN (SELECT date FROM day_sends);
