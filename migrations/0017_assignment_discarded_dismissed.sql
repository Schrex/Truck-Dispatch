-- A cancelled Assignment can be cleared away, on each side on its own:
-- discarded_at: when Dave discarded it from the Board. The Board no longer
--   lists it; the Driver still sees it cancelled until he dismisses it.
-- dismissed_at: when its Driver dismissed it from the Driver view. His day no
--   longer lists it; the Board is unchanged.
-- Neither deletes anything: the row stays, cancelled, for the Truck log.
-- Put back empties both. Only adds; nothing is changed.

ALTER TABLE assignments ADD COLUMN discarded_at TEXT;
ALTER TABLE assignments ADD COLUMN dismissed_at TEXT;
