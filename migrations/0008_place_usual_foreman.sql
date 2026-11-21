-- A job-site Place's usual Foreman, whom the composer fills in on a new
-- Assignment that drops off there (or picks up there when the drop-off is not
-- a job site). The Assignment keeps its own Foreman, so changing this never
-- rewrites a planned or past day. Only job sites have one; the Worker keeps
-- it empty on every other Place. Empty on every existing Place.
-- Only adds; nothing is changed.

ALTER TABLE places ADD COLUMN usual_foreman_id TEXT REFERENCES foremen (id);
