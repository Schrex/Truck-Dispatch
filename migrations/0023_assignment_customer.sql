-- For: whose work an Assignment is, a Foreman or a Customer. The Customer
-- sits beside the Foreman; the Worker keeps at most one of the two, so
-- existing Assignments keep their Foreman. Only adds; nothing is changed.

ALTER TABLE assignments ADD COLUMN customer_id TEXT REFERENCES customers (id);
