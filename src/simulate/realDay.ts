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
import type { FleetVisit, IgnitionEvent, TripAssignment, TripJob, TripPlace, TruckCheckIn } from '../../shared/trips';

/** An Assignment as the simulation plans it: what the Trip builder matches, and the Material the board shows. */
export interface PlannedAssignment extends TripAssignment {
  materialName: string;
  /** Whose it is; none means Randy's. */
  driverId?: string;
  /** The Truck it names; none means the Driver's usual one. */
  truckId?: string | null;
}

/** The Truck's day as a made-up scenario has it instead of the real one: its Fleet rows, meter readings and ignition. */
export interface ScenarioDay {
  visits: FleetVisit[];
  meter: { startOdometer: number; endOdometer: number; endReadAt: string };
  ignition: IgnitionEvent[];
}

export interface Scenario {
  id: string;
  name: string;
  /** Dave's Assignments, in his order: Randy's unless they name another Driver. */
  assignments: PlannedAssignment[];
  /** The Drivers on the board that day; none means Randy only. */
  drivers?: Driver[];
  /** A made-up day in place of the real one (e.g. a run to split); none means the real 16 Nov day. */
  day?: ScenarioDay;
  /** The check-ins to Truck 55 that day; none means Randy checked in at the start of the day. */
  checkIns?: TruckCheckIn[];
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

/** MCK-55-17's raw Fleet rows, UTC. "sunset" is a geofence the Truck only drives through (61 s each time), on no Place and not considered. */
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

const place = (id: string, name: string, fullName: string, kind: TripPlace['kind'], geofenceCode: string, jobId: string | null = null): TripPlace => ({
  id,
  name,
  fullName,
  kind,
  geofenceCode,
  jobId,
});
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
  extra: Partial<Omit<TripAssignment, 'driverId' | 'truckId'>> = {},
  whose: Pick<PlannedAssignment, 'driverId' | 'truckId'> = {},
): PlannedAssignment => ({ id, label, fromPlaceId, toPlaceId, materialName, atPlaceId: null, cancelledAt: null, changes: [], ...extra, ...whose });

const A2 = assignment('a2', 'A2', WALWORTH, J25008, '1&2 stone');

const RANDY = { id: 'drv-randy', name: 'Randy', defaultTruckId: 'trk-55', sortOrder: 1, active: true } satisfies Driver;
/** Made up for the "Who was driving?" scenario: a spare Driver with no usual Truck. */
const SAM = { id: 'drv-sam', name: 'Sam', defaultTruckId: null, sortOrder: 2, active: true } satisfies Driver;

/**
 * Made up, not Fleet data: a day whose one run held two hauls, for Split
 * (#77). Two Loads of A1 from Walworth to J25008, then J25008 → J611 →
 * Villager → J25008 that nothing Dave Assigned explains, then the shop.
 */
const SPLIT_DAY: ScenarioDay = {
  visits: [
    visit('SHOP', '2026-11-16T05:00:00Z', '2026-11-16T11:25:00Z', 258050.59, 258050.9),
    visit('WALWDOLO', '2026-11-16T12:00:00Z', '2026-11-16T12:12:00Z', 258071.0, 258072.0),
    visit('J25008 Los Flamboyanes', '2026-11-16T12:40:00Z', '2026-11-16T12:58:00Z', 258093.0, 258093.2),
    visit('WALWDOLO', '2026-11-16T13:25:00Z', '2026-11-16T13:37:00Z', 258114.4, 258115.4),
    visit('J25008 Los Flamboyanes', '2026-11-16T14:05:00Z', '2026-11-16T14:20:00Z', 258136.6, 258136.8),
    visit('J611 Bishop Kearney', '2026-11-16T14:30:00Z', '2026-11-16T14:45:00Z', 258140.3, 258140.6),
    visit('VILLAGER', '2026-11-16T15:00:00Z', '2026-11-16T15:10:00Z', 258144.2, 258144.5),
    visit('J25008 Los Flamboyanes', '2026-11-16T15:25:00Z', '2026-11-16T15:40:00Z', 258148.1, 258148.3),
    visit('SHOP', '2026-11-16T16:05:00Z', null, 258166.7, null),
  ],
  meter: { startOdometer: 258050.59, endOdometer: 258166.7, endReadAt: '2026-11-17T03:12:00Z' },
  ignition: [
    { at: '2026-11-16T11:20:00Z', on: true },
    { at: '2026-11-16T16:10:00Z', on: false },
  ],
};

export const REAL_DAY = {
  date: '2026-11-16',
  truck: { id: 'trk-55', number: '55', hcssCode: 'MCK-55-17', hcssGuid: null, active: true } satisfies Truck,
  /** Randy, whose usual Truck is 55. */
  driver: RANDY,
  places: [
    place(SHOP, 'Shop', 'Our shop and equipment yard', 'shop', 'SHOP'),
    place(J25008, 'J25008 Los Flamboyanes', 'Los Flamboyanes - Christa', 'job_site', 'J25008 Los Flamboyanes', 'job-j25008'),
    place(VILLAGER, 'Villager', 'Villager City Plant', 'plant', 'VILLAGER'),
    place(WALWORTH, 'Walworth Dolomite', 'Walworth Dolomite Plant', 'plant', 'WALWDOLO'),
    place(J611, 'J611 Bishop Kearney', 'Bishop Kearney Performance Center', 'job_site', 'J611 Bishop Kearney', 'job-j611'),
  ],
  /** The two job sites' Jobs; the plants and the shop belong to none. */
  jobs: [
    { id: 'job-j25008', jobNumber: 'J25008', name: 'Los Flamboyanes' },
    { id: 'job-j611', jobNumber: 'J611', name: 'Bishop Kearney' },
  ] satisfies TripJob[] as TripJob[],
  visits: VISITS,
  /** Dave's Not considered list: "sunset", the road fence the Truck drives through, so the day reads as it always has. */
  notConsidered: ['sunset'],
  /** The Materials Dave picks from when he answers Unplanned work ("or type it" for another). */
  materials: ['Fill', '1&2 stone', 'Top soil'],
  /** The meter readings around the day: 258,050.59 read 15 Nov 21:41 ET, 258,212.20 read 16 Nov 22:12 ET. */
  meter: { startOdometer: 258050.59, endOdometer: 258212.2, endReadAt: '2026-11-17T03:12:00Z' },
  /** From the ping history: Ignition On 06:19:40, Ignition Off 16:12:45 US Eastern. */
  ignition: [
    { at: '2026-11-16T11:19:40Z', on: true },
    { at: '2026-11-16T21:12:45Z', on: false },
  ] satisfies IgnitionEvent[] as IgnitionEvent[],
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
    {
      id: 'split',
      name: 'Made up: Unplanned work to split',
      // Nothing explains the run J25008 → J611 → Villager → J25008: two hauls in one piece of Unplanned work.
      assignments: [assignment('a1', 'A1', WALWORTH, J25008, '1&2 stone')],
      day: SPLIT_DAY,
    },
    {
      id: 'two-drivers',
      name: 'Made up: Sam on Truck 55 too',
      // Randy's A1 (his own Truck) and Sam's A2 both name Truck 55, and nobody checked in: the Truck log asks "Who was driving?".
      assignments: [assignment('a1', 'A1', J25008, VILLAGER, 'Fill'), assignment('a2', 'A2', WALWORTH, J25008, '1&2 stone', {}, { driverId: SAM.id, truckId: 'trk-55' })],
      drivers: [RANDY, SAM],
      checkIns: [],
    },
    {
      id: 'two-the-same',
      name: 'Made up: two the same',
      // A2 and A3 both run Walworth → J25008: the rules do not guess, the Truck log asks "Which Assignment? A2 or A3".
      assignments: [assignment('a1', 'A1', J25008, VILLAGER, 'Fill'), A2, assignment('a3', 'A3', WALWORTH, J25008, '1&2 stone')],
    },
  ] satisfies Scenario[] as Scenario[],
};

/** The name of one of the day's Places by its id; null for a geofence code with no Place (show the code instead). */
export const placeName = (id: string | null): string | null => REAL_DAY.places.find((p) => p.id === id)?.name ?? null;
