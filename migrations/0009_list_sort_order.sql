-- Dave's own order for the Drivers, Places and Materials, set in Settings:
-- lanes and the composer's chips follow it. 1 is first. An entry without one
-- (every existing entry until Dave orders its list, and a new or brought-back
-- one) comes after the ordered ones, then by name.
-- Only adds; nothing is changed.

ALTER TABLE drivers ADD COLUMN sort_order INTEGER;
ALTER TABLE places ADD COLUMN sort_order INTEGER;
ALTER TABLE materials ADD COLUMN sort_order INTEGER;
