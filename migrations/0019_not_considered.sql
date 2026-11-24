-- The Not considered list (Settings): geofence codes the Trip builder always
-- skips, such as a fuel stop or a road fence. A visit to one is dropped before
-- Trips are built, however long the Truck stayed. Like the other lists,
-- entries are never deleted, only made inactive (taking a code off the list
-- brings its visits back), and a code is unique in the list, ignoring case.
-- A code needs no Place.
-- Only adds; nothing is changed.

CREATE TABLE not_considered (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE UNIQUE INDEX not_considered_by_code ON not_considered (code COLLATE NOCASE);
