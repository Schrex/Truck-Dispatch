-- Drivers, and dispatch orders: work for one day, assigned to a driver,
-- optionally with a truck number. Schema only; test data is in seed/fixture.sql.

CREATE TABLE drivers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  work_date TEXT NOT NULL CHECK (work_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  start_time TEXT CHECK (start_time IS NULL OR start_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  job TEXT NOT NULL,
  work TEXT NOT NULL,
  pickup TEXT NOT NULL DEFAULT '',
  dropoff TEXT NOT NULL DEFAULT '',
  driver_id TEXT NOT NULL REFERENCES drivers (id),
  truck_number TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX orders_by_date ON orders (work_date, start_time);
