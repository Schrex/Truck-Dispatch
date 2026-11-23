/**
 * The simulation's one real day: Truck 55 (MCK-55-17), driven by Randy on
 * Mon 16 Nov 2026. The raw visits are the HCSS Fleet entry/exit JSON (pulled
 * 15:02 ET), completed from the entry/exit xlsx exported later that day; the
 * meter readings are the Supabase snapshots; the ignition times the ping
 * history. Real Place names, unlike the seed and shared/trips.fixture.ts (the
 * tests' made-up day). Dave's real Assignments for that day were not shared,
 * so the scenarios are as Dave made them for the simulation.
 */
import type { Driver, Truck } from '../../shared/types';
import type { FleetVisit, TripAssignment, TripPlace } from '../../shared/trips';

/** An Assignment as the simulation plans it: what the Trip builder matches, and the Material the board shows. */
export interface PlannedAssignment extends TripAssignment {
  materialName: string;
}

export interface Scenario {
  id: string;
  name: string;
  /** Dave's Assignments for Randy, in his order. */
  assignments: PlannedAssignment[];
}

/** US Eastern's offset on a date, "-05:00" or "-04:00". */
function easternOffset(date: string): string {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' })
    .formatToParts(new Date(`${date}T12:00:00Z`))
    .find((p) => p.type === 'timeZoneName')?.value;
  const hours = Number(name?.replace('GMT', '') || -5);
  return `-${String(Math.abs(hours)).padStart(2, '0')}:00`;
}

/** A US Eastern clock time ("10:02:59") on a date, as ISO 8601. */
export const easternIso = (date: string, time: string) => `${date}T${time}${easternOffset(date)}`;

const visit = (geofenceCode: string, enteredAt: string, exitedAt: string | null, entryOdometer: number, exitOdometer: number | null): FleetVisit => ({
  geofenceCode,
  enteredAt,
  exitedAt,
  entryOdometer,
  exitOdometer,
});

/** MCK-55-17's raw Fleet rows, UTC. "sunset" is a geofence the Truck only drives through (61 s each time), on no Place. */
const VISITS: FleetVisit[] = [
  visit('SHOP', '2026-11-16T05:00:00Z', '2026-11-16T11:24:46Z', 258050.59, 258050.91),
  visit('J25008 Los Flamboyanes', '2026-11-16T12:02:03Z', '2026-11-16T12:13:29Z', 258071.5, 258071.91),
  visit('J25008 Los Flamboyanes', '2026-11-16T12:15:31Z', '2026-11-16T13:24:26Z', 258072.7, 258072.91),
  visit('VILLAGER', '2026-11-16T13:34:37Z', '2026-11-16T13:43:48Z', 258076.3, 258076.59),
  visit('J25008 Los Flamboyanes', '2026-11-16T13:56:13Z', '2026-11-16T14:35:33Z', 258080.2, 258080.3),
  visit('VILLAGER', '2026-11-16T14:46:49Z', '2026-11-16T14:50:54Z', 258083.8, 258084.09),
  visit('sunset', '2026-11-16T14:52:56Z', '2026-11-16T14:53:57Z', 258084.91, 258085.41),
  visit('J25008 Los Flamboyanes', '2026-11-16T15:00:04Z', '2026-11-16T15:27:50Z', 258087.3, 258087.5),
  visit('VILLAGER', '2026-11-16T15:38:03Z', '2026-11-16T15:41:06Z', 258090.91, 258091.09),
  visit('sunset', '2026-11-16T15:47:14Z', '2026-11-16T15:48:16Z', 258092.41, 258092.8),
  visit('J25008 Los Flamboyanes', '2026-11-16T15:53:23Z', '2026-11-16T16:14:33Z', 258094.7, 258094.91),
  visit('VILLAGER', '2026-11-16T16:25:45Z', '2026-11-16T16:30:53Z', 258098.3, 258098.7),
  visit('WALWDOLO', '2026-11-16T16:56:23Z', '2026-11-16T17:08:37Z', 258119.09, 258120.09),
  visit('J25008 Los Flamboyanes', '2026-11-16T17:36:09Z', '2026-11-16T17:54:36Z', 258141.3, 258141.5),
  visit('WALWDOLO', '2026-11-16T18:18:02Z', '2026-11-16T18:29:15Z', 258162.7, 258163.91),
  visit('J25008 Los Flamboyanes', '2026-11-16T18:54:45Z', '2026-11-16T19:15:43Z', 258185.09, 258185.41),
  visit('J611 Bishop Kearney', '2026-11-16T19:23:53Z', '2026-11-16T19:33:17Z', 258188.91, 258189.2),
  // Open when the JSON was pulled (15:02 ET); closed at 15:41:56 in the later xlsx export. Exit odometer from the ping history (258050.59 + 142.81).
  visit('J25008 Los Flamboyanes', '2026-11-16T19:43:31Z', '2026-11-16T20:41:56Z', 258192.91, 258193.4),
  // From the xlsx export only: back at the shop at 16:03:25, still there at midnight. Entry odometer from the ping history (258050.59 + 161.20).
  visit('SHOP', '2026-11-16T21:03:25Z', null, 258211.79, null),
];

const place = (id: string, name: string, fullName: string, kind: TripPlace['kind'], geofenceCode: string): TripPlace => ({ id, name, fullName, kind, geofenceCode });
const SHOP = 'plc-shop';
const J25008 = 'plc-j25008';
const VILLAGER = 'plc-villager';
const WALWORTH = 'plc-walworth';
const J611 = 'plc-j611';

const assignment = (
  id: string,
  label: string,
  fromPlaceId: string | null,
  toPlaceId: string | null,
  materialName: string,
  extra: Partial<TripAssignment> = {},
): PlannedAssignment => ({ id, label, fromPlaceId, toPlaceId, materialName, cancelledAt: null, changes: [], ...extra });

const A2 = assignment('a2', 'A2', WALWORTH, J25008, '1&2 stone');

export const REAL_DAY = {
  date: '2026-11-16',
  truck: { id: 'trk-55', number: '55', hcssCode: 'MCK-55-17', hcssGuid: null, active: true } satisfies Truck,
  /** Randy, whose usual Truck is 55. */
  driver: { id: 'drv-randy', name: 'Randy', defaultTruckId: 'trk-55', sortOrder: 1, active: true } satisfies Driver,
  places: [
    place(SHOP, 'Shop', 'Our shop and equipment yard', 'shop', 'SHOP'),
    place(J25008, 'J25008 Los Flamboyanes', 'Los Flamboyanes - Christa', 'job_site', 'J25008 Los Flamboyanes'),
    place(VILLAGER, 'Villager', 'Villager City Plant', 'plant', 'VILLAGER'),
    place(WALWORTH, 'Walworth Dolomite', 'Walworth Dolomite Plant', 'plant', 'WALWDOLO'),
    place(J611, 'J611 Bishop Kearney', 'Bishop Kearney Performance Center', 'job_site', 'J611 Bishop Kearney'),
  ],
  visits: VISITS,
  /** The meter readings around the day: 258,050.59 read 15 Nov 21:41 ET, 258,212.20 read 16 Nov 22:12 ET. */
  meter: { startOdometer: 258050.59, endOdometer: 258212.2 },
  /** From the ping history: Ignition On 06:19:40, Ignition Off 16:12:45 US Eastern. */
  ignition: { on: '2026-11-16T11:19:40Z', off: '2026-11-16T21:12:45Z' },
  scenarios: [
    { id: 'planned', name: 'As planned', assignments: [assignment('a1', 'A1', J25008, VILLAGER, 'Fill'), A2] },
    { id: 'other-way', name: 'The other way round', assignments: [assignment('a1', 'A1', VILLAGER, J25008, 'Fill'), A2] },
    {
      id: 'reroute',
      name: 'Reroute at 11:20',
      // At 11:20 Dave changed A1's drop-off from Villager to Bishop Kearney; Trips before that match A1 as it was.
      assignments: [
        assignment('a1', 'A1', J25008, J611, 'Fill', { changes: [{ changedAt: '2026-11-16T16:20:00Z', before: { fromPlaceId: J25008, toPlaceId: VILLAGER } }] }),
        A2,
      ],
    },
  ] satisfies Scenario[] as Scenario[],
};
