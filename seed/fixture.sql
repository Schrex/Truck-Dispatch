-- Synthetic Drivers to give Assignments to. Made-up names, never real people.
-- No Assignments: the board starts empty and they are added with "Add Assignment".
-- Safe to run again and again: INSERT OR IGNORE never changes or duplicates rows.

INSERT OR IGNORE INTO drivers (id, name) VALUES
  ('drv-a', 'Sample Driver A'),
  ('drv-b', 'Sample Driver B'),
  ('drv-c', 'Sample Driver C');
