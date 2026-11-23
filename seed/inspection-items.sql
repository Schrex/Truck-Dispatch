-- The Inspection checklist's starting items: the paper Daily Truck Log &
-- Inspection's 12 items, in its order. Reference data, not test data: every
-- environment loads this file (local via bun run setup, preview, staging and
-- production), and it is separate from the synthetic fixture.sql.
-- Safe to run again and again: INSERT OR IGNORE with fixed ids never changes
-- or duplicates rows, so Dave's renames, reorders and removals survive.

INSERT OR IGNORE INTO inspection_items (id, label, optional, sort_order) VALUES
  ('insp-01', 'Dump box clean', 0, 1),
  ('insp-02', 'Air leaks / brake pressure', 0, 2),
  ('insp-03', 'Truck paperwork', 0, 3),
  ('insp-04', 'Mud flaps', 0, 4),
  ('insp-05', 'Fire ext / triangles', 0, 5),
  ('insp-06', 'Tires / wheels', 0, 6),
  ('insp-07', 'Lights', 0, 7),
  ('insp-08', 'Coolant', 0, 8),
  ('insp-09', 'Engine oil', 0, 9),
  ('insp-10', 'Fueled up', 0, 10),
  ('insp-11', 'Air tank (drain)', 0, 11),
  ('insp-12', 'Suspension', 0, 12);
