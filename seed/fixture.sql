-- Synthetic Trucks, Drivers, Jobs, Places, Materials and Foremen to plan Assignments with.
-- Made-up names and numbers, never real people, Trucks, Jobs or Places.
-- No Assignments: the board starts empty and they are added with "Add Assignment".
-- Safe to run again and again: INSERT OR IGNORE never changes or duplicates rows.

INSERT OR IGNORE INTO trucks (id, number, hcss_code, hcss_guid) VALUES
  ('trk-21', '21', 'SAMPLE-21', NULL),
  ('trk-24', '24', NULL, NULL),
  ('trk-27', '27', NULL, NULL);

INSERT OR IGNORE INTO drivers (id, name, default_truck_id) VALUES
  ('drv-a', 'Sample Driver A', 'trk-21'),
  ('drv-b', 'Sample Driver B', 'trk-24'),
  ('drv-c', 'Sample Driver C', NULL);

INSERT OR IGNORE INTO jobs (id, name, job_number) VALUES
  ('job-n', 'Sample Job North', 'S-1001'),
  ('job-s', 'Sample Job South', NULL);

INSERT OR IGNORE INTO places (id, short_name, full_name, kind, job_id, geofence_code) VALUES
  ('plc-plant', 'Sample Plant', 'Sample Aggregate Plant', 'plant', NULL, 'SAMPLE-PLANT'),
  ('plc-north', 'Sample Site North', 'Sample Job North site', 'job_site', 'job-n', NULL),
  ('plc-shop', 'Sample Shop', NULL, 'shop', NULL, NULL),
  ('plc-yard', 'Sample Yard', NULL, 'yard', NULL, NULL);

-- Synthetic Materials and Foremen to pick on Assignments. Made-up names, never real people.
INSERT OR IGNORE INTO materials (id, name) VALUES
  ('mat-minus', '2" minus'),
  ('mat-dirt', 'Sample Dirt'),
  ('mat-stone', 'Sample Stone');

INSERT OR IGNORE INTO foremen (id, name) VALUES
  ('frm-a', 'Sample Foreman A'),
  ('frm-b', 'Sample Foreman B'),
  ('frm-c', 'Sample Foreman C');
