-- Trucks, each Driver's usual Truck, and the Truck on an Assignment.
-- Lists are never deleted from: an entry is made inactive instead, so old
-- Assignments keep its name. The display name of a list (Driver name, Truck
-- number) is unique within it, ignoring case. Only adds; nothing is changed.

CREATE TABLE trucks (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL,
  hcss_code TEXT,
  hcss_guid TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE UNIQUE INDEX trucks_by_number ON trucks (number COLLATE NOCASE);

ALTER TABLE drivers ADD COLUMN default_truck_id TEXT REFERENCES trucks (id);
ALTER TABLE drivers ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1));

CREATE UNIQUE INDEX drivers_by_name ON drivers (name COLLATE NOCASE);

ALTER TABLE assignments ADD COLUMN truck_id TEXT REFERENCES trucks (id);
