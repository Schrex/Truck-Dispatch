/**
 * SQL that check-ins and Truck problems both read Inspections with, kept in
 * one place so they agree on what a Driver's check-in is.
 */

/**
 * Each Driver's latest Inspection on the day bound to its one `?`: the newest
 * done_at, ties broken by the order they were added. Columns: id, driverId,
 * truckId, doneAt.
 */
export const LATEST_INSPECTIONS = `SELECT id, driverId, truckId, doneAt
  FROM (SELECT id, driver_id AS driverId, truck_id AS truckId, done_at AS doneAt,
               ROW_NUMBER() OVER (PARTITION BY driver_id ORDER BY done_at DESC, rowid DESC) AS newest
          FROM inspections WHERE date = ?)
 WHERE newest = 1`;

/** 1 when any answer of the Inspection aliased `alias` is Needs repair, else 0. */
export const needsRepair = (alias: string) =>
  `EXISTS (SELECT 1 FROM inspection_answers a WHERE a.inspection_id = ${alias}.id AND a.answer = 'repair')`;
