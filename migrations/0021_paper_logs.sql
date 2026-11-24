-- Paper log photos (GLOSSARY.md: Paper log): a photo of the paper Daily Truck
-- Log for one Truck on one day, attached as a backup. A Truck's Paper log for
-- a day is all of its photos that day. Only a photo: nothing on the sheet is
-- typed. Never changes Loads, hours, miles or "Who was driving?".
-- id: made by the phone (a UUID), so a retried attach is recognised.
-- date: the day the sheet is for, today or a past day in US Eastern time
-- (the Worker refuses a day to come; a past day is allowed on purpose).
-- truck_id, driver_id: whose day it is; they need only exist, active or not.
-- attached_by: who attached it, 'driver' or 'dave'.
-- attached_at, taken_off_at: the Worker's clock, exact UTC moments (ISO 8601).
-- A photo taken off is hidden from the day and kept; a row is never deleted.
-- picture_key: where the picture is in the photos bucket (R2), private and
-- read only through the Worker; content_type and size describe it.
-- Only adds; nothing is changed.

CREATE TABLE paper_log_photos (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  truck_id TEXT NOT NULL REFERENCES trucks (id),
  driver_id TEXT NOT NULL REFERENCES drivers (id),
  attached_by TEXT NOT NULL CHECK (attached_by IN ('driver', 'dave')),
  attached_at TEXT NOT NULL,
  picture_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size > 0),
  taken_off_at TEXT
);

-- A day's photos, and one Driver's on a day.
CREATE INDEX paper_log_photos_by_date ON paper_log_photos (date, driver_id);
