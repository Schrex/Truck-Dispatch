-- The kind of work an Assignment is: a Haul (the default, and every
-- Assignment before this), a Move (an equipment move, with its machine
-- typed) or Other. Named `work`, as `kind` already means a Place's kind and
-- a Trip's kind. Only adds: every existing Assignment reads as a Haul.

ALTER TABLE assignments ADD COLUMN work TEXT NOT NULL DEFAULT 'haul' CHECK (work IN ('haul', 'move', 'other'));
ALTER TABLE assignments ADD COLUMN machine TEXT;
