-- At: the Place an Assignment's Truck works at, usually the Job site, beside
-- its From and To. Optional; existing Assignments have none. Only adds.

ALTER TABLE assignments ADD COLUMN at_place_id TEXT REFERENCES places (id);
