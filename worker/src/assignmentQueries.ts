/**
 * SQL the day reads, the Driver day read and the Truck log read Assignments
 * with, kept in one place so they list and mark them alike.
 */
import { listOrder } from './lists';
import { sinceSent } from '../../shared/days';
import type { Assignment } from '../../shared/types';

/**
 * Each Assignment with the names of its Driver, Truck, Places (From, To, At), Material and
 * For (its Foreman or Customer), so the page never has to look them up, and when it was Assigned,
 * from which marked() works out whether it is Changed or Added.
 */
export const SELECT_ASSIGNMENT = `SELECT a.id, a.date, a.driver_id AS driverId, d.name AS driverName,
       a.truck_id AS truckId, t.number AS truckNumber,
       a.from_place_id AS fromPlaceId, pf.short_name AS fromPlaceName,
       a.to_place_id AS toPlaceId, pt.short_name AS toPlaceName,
       a.at_place_id AS atPlaceId, pa.short_name AS atPlaceName,
       a.material_id AS materialId, m.name AS materialName,
       a.foreman_id AS foremanId, f.name AS foremanName, a.customer_id AS customerId, c.name AS customerName, a.note,
       a.position, a.created_at AS createdAt, a.updated_at AS updatedAt, a.changed_at AS changedAt, a.cancelled_at AS cancelledAt,
       a.assigned_at AS assignedAt, a.handed_from AS handedFromId
  FROM assignments a LEFT JOIN drivers d ON d.id = a.driver_id LEFT JOIN trucks t ON t.id = a.truck_id
  LEFT JOIN places pf ON pf.id = a.from_place_id LEFT JOIN places pt ON pt.id = a.to_place_id
  LEFT JOIN places pa ON pa.id = a.at_place_id
  LEFT JOIN materials m ON m.id = a.material_id LEFT JOIN foremen f ON f.id = a.foreman_id
  LEFT JOIN customers c ON c.id = a.customer_id`;

/**
 * How a day's Assignments are listed: lane by lane (in the Drivers' order,
 * as their list is read, the Unassigned lane last), then in each lane's order,
 * ties (such as Assignments saved before they had a position) in the order
 * they were added.
 */
export const DAY_ORDER = `ORDER BY a.driver_id IS NULL, ${listOrder('drivers', 'd')}, a.driver_id, a.position, a.created_at, a.rowid`;

/** An Assignment as SELECT_ASSIGNMENT reads it: everything but whether it is Changed or Added. */
export type AssignmentRow = Omit<Assignment, 'sinceSent'>;

/** An Assignment as the API answers it: Changed, Added or neither since it was Assigned, by the shared day rules. */
export function marked(assignment: AssignmentRow): Assignment {
  return { ...assignment, sinceSent: sinceSent(assignment) };
}

