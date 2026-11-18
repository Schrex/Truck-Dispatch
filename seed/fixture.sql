-- Synthetic drivers to assign orders to. Made-up names, never real people.
-- No orders: the board starts empty and orders are added with "New Order".
-- Safe to run again and again: INSERT OR IGNORE never changes or duplicates rows.

INSERT OR IGNORE INTO drivers (id, name) VALUES
  ('drv-a', 'Sample Driver A'),
  ('drv-b', 'Sample Driver B'),
  ('drv-c', 'Sample Driver C');
