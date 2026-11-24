-- Customers: someone outside the company we haul for (e.g. a hired-out job),
-- never a Foreman. A list like Foremen: entries are never deleted, only made
-- inactive, and a name is unique in the list, ignoring case. The Worker also
-- keeps a name from being both a Foreman's and a Customer's. A Customer may
-- have a usual Place, which the composer will fill in as the Assignment's At.
-- No timestamps and no order, like Foremen. Nothing is seeded.
-- Only adds; nothing is changed.

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  usual_place_id TEXT REFERENCES places (id),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE UNIQUE INDEX customers_by_name ON customers (name COLLATE NOCASE);
