/**
 * One Truck's day for the Trip builder's tests and the simulation page. The
 * times, odometers and order are a real HCSS Fleet day (Mon 16 Nov 2026); the
 * names are made up, like seed/fixture.sql: never real Jobs, Places or people.
 */
import type { FleetVisit, TripAssignment, TripPlace } from './trips';

export const FIXTURE_DATE = '2026-11-16';

export const FIXTURE_PLACES: TripPlace[] = [
  { id: 'plc-shop', name: 'Sample Shop', kind: 'shop', geofenceCode: 'SHOP' },
  { id: 'plc-north', name: 'Sample Site North', kind: 'job_site', geofenceCode: 'J1001 North' },
  { id: 'plc-plant', name: 'Sample Plant', kind: 'plant', geofenceCode: 'PLANT' },
  { id: 'plc-quarry', name: 'Sample Quarry', kind: 'plant', geofenceCode: 'QUARRY' },
  { id: 'plc-south', name: 'Sample Site South', kind: 'job_site', geofenceCode: 'J1002 South' },
];

const v = (geofenceCode: string, enteredAt: string, exitedAt: string | null, entryOdometer: number, exitOdometer: number | null): FleetVisit => ({
  geofenceCode,
  enteredAt,
  exitedAt,
  entryOdometer,
  exitOdometer,
});

/**
 * The raw Fleet rows, UTC. ROAD is a geofence the Truck only drives through
 * (61 s each time) and is on no Place. The two North visits at 07:02 and
 * 07:15 ET are one stay with a short exit between them.
 */
export const FIXTURE_VISITS: FleetVisit[] = [
  v('SHOP', '2026-11-16T05:00:00Z', '2026-11-16T11:24:46Z', 258050.59, 258050.91),
  v('J1001 North', '2026-11-16T12:02:03Z', '2026-11-16T12:13:29Z', 258071.5, 258071.91),
  v('J1001 North', '2026-11-16T12:15:31Z', '2026-11-16T13:24:26Z', 258072.7, 258072.91),
  v('PLANT', '2026-11-16T13:34:37Z', '2026-11-16T13:43:48Z', 258076.3, 258076.59),
  v('J1001 North', '2026-11-16T13:56:13Z', '2026-11-16T14:35:33Z', 258080.2, 258080.3),
  v('PLANT', '2026-11-16T14:46:49Z', '2026-11-16T14:50:54Z', 258083.8, 258084.09),
  v('ROAD', '2026-11-16T14:52:56Z', '2026-11-16T14:53:57Z', 258084.91, 258085.41),
  v('J1001 North', '2026-11-16T15:00:04Z', '2026-11-16T15:27:50Z', 258087.3, 258087.5),
  v('PLANT', '2026-11-16T15:38:03Z', '2026-11-16T15:41:06Z', 258090.91, 258091.09),
  v('ROAD', '2026-11-16T15:47:14Z', '2026-11-16T15:48:16Z', 258092.41, 258092.8),
  v('J1001 North', '2026-11-16T15:53:23Z', '2026-11-16T16:14:33Z', 258094.7, 258094.91),
  v('PLANT', '2026-11-16T16:25:45Z', '2026-11-16T16:30:53Z', 258098.3, 258098.7),
  v('QUARRY', '2026-11-16T16:56:23Z', '2026-11-16T17:08:37Z', 258119.09, 258120.09),
  v('J1001 North', '2026-11-16T17:36:09Z', '2026-11-16T17:54:36Z', 258141.3, 258141.5),
  v('QUARRY', '2026-11-16T18:18:02Z', '2026-11-16T18:29:15Z', 258162.7, 258163.91),
  v('J1001 North', '2026-11-16T18:54:45Z', '2026-11-16T19:15:43Z', 258185.09, 258185.41),
  v('J1002 South', '2026-11-16T19:23:53Z', '2026-11-16T19:33:17Z', 258188.91, 258189.2),
  v('J1001 North', '2026-11-16T19:43:31Z', '2026-11-16T20:41:56Z', 258192.91, 258193.4),
  v('SHOP', '2026-11-16T21:03:25Z', null, 258211.79, null),
];

/** The 4 AM meter readings around the day. */
export const FIXTURE_METER = { startOdometer: 258050.59, endOdometer: 258212.2 };

const assignment = (id: string, label: string, fromPlaceId: string | null, toPlaceId: string | null, extra: Partial<TripAssignment> = {}): TripAssignment => ({
  id,
  label,
  fromPlaceId,
  toPlaceId,
  cancelledAt: null,
  changes: [],
  ...extra,
});

/** Ready-made Assignment sets, each showing one part of the matching. */
export const FIXTURE_SCENARIOS: { id: string; name: string; about: string; assignments: TripAssignment[] }[] = [
  {
    id: 'two',
    name: 'Two Assignments',
    about: 'A1 hauls from North to the Plant, A2 from the Quarry to North. The South stop fits neither.',
    assignments: [assignment('a1', 'A1', 'plc-north', 'plc-plant'), assignment('a2', 'A2', 'plc-quarry', 'plc-north')],
  },
  {
    id: 'blank-to',
    name: 'A1 with no To',
    about: 'Dave left A1’s To empty. Ways back and drives to the shop must still not count as Loads.',
    assignments: [assignment('a1', 'A1', 'plc-north', null), assignment('a2', 'A2', 'plc-quarry', 'plc-north')],
  },
  {
    id: 'reroute',
    name: 'Reroute at 11:20',
    about: 'At 11:20 Dave changed A1’s To from the Plant to South. Trips before that match A1 as it was.',
    assignments: [
      assignment('a1', 'A1', 'plc-north', 'plc-south', { changes: [{ changedAt: '2026-11-16T16:20:00Z', before: { fromPlaceId: 'plc-north', toPlaceId: 'plc-plant' } }] }),
      assignment('a2', 'A2', 'plc-quarry', 'plc-north'),
    ],
  },
  {
    id: 'ambiguous',
    name: 'Two the same',
    about: 'Two Assignments with the same From and To: the rules do not guess, Dave chooses.',
    assignments: [assignment('a1', 'A1', 'plc-north', 'plc-plant'), assignment('a3', 'A3', 'plc-north', 'plc-plant'), assignment('a2', 'A2', 'plc-quarry', 'plc-north')],
  },
];
