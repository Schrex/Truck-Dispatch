/**
 * The days the simulation page can run: a real HCSS Fleet day (the default),
 * the made-up day the tests use, and any entry/exit export uploaded in the
 * page. Each carries its Places, raw Fleet visits, meter readings and some
 * ready-made sets of Assignments to match against.
 */
import { parseFleetEntryExit, type FleetDay } from '../../shared/fleetImport';
import type { FleetVisit, TripAssignment, TripPlace } from '../../shared/trips';
import { FIXTURE_DATE, FIXTURE_METER, FIXTURE_PLACES, FIXTURE_SCENARIOS, FIXTURE_VISITS } from '../../shared/trips.fixture';

export interface Scenario {
  id: string;
  name: string;
  about: string;
  assignments: TripAssignment[];
}

export interface Dataset {
  id: string;
  name: string;
  /** Where the data came from, shown on the page. */
  source: string;
  date: string;
  truck: string;
  places: TripPlace[];
  visits: FleetVisit[];
  meter: { startOdometer: number; endOdometer: number; source: string } | null;
  /** Other facts from the sources, shown as they are (ignition times, readings). */
  facts: string[];
  scenarios: Scenario[];
}

const row = (code: string, type: string, description: string | null, entry: string, exit: string | null, entryOdometer: number, exitOdometer: number | null) => ({
  EquipmentCode: 'MCK-55-17',
  EquipmentDescription: '2017 Mack Granite - 55',
  GeofenceCode: code,
  GeofenceType: type,
  GeofenceDescription: description,
  EntryDateTime: entry,
  ExitDateTime: exit,
  EntryOdometer: entryOdometer,
  ExitOdometer: exitOdometer,
});

/**
 * MCK-55-17 on Mon 16 Nov 2026, from the HCSS Fleet entry/exit JSON (pulled
 * 15:02 ET), completed from the entry/exit xlsx exported later that day.
 */
const MCK_55_17_ROWS = [
  row("SHOP", "Other", "Our shop and equipment yard", "2026-11-16T05:00:00+00:00", "2026-11-16T11:24:46+00:00", 258050.59, 258050.91),
  row("J25008 Los Flamboyanes", "Job", "Los Flamboyanes - Christa", "2026-11-16T12:02:03+00:00", "2026-11-16T12:13:29+00:00", 258071.5, 258071.91),
  row("J25008 Los Flamboyanes", "Job", "Los Flamboyanes - Christa", "2026-11-16T12:15:31+00:00", "2026-11-16T13:24:26+00:00", 258072.7, 258072.91),
  row("VILLAGER", "Plant", "Villager City Plant", "2026-11-16T13:34:37+00:00", "2026-11-16T13:43:48+00:00", 258076.3, 258076.59),
  row("J25008 Los Flamboyanes", "Job", "Los Flamboyanes - Christa", "2026-11-16T13:56:13+00:00", "2026-11-16T14:35:33+00:00", 258080.2, 258080.3),
  row("VILLAGER", "Plant", "Villager City Plant", "2026-11-16T14:46:49+00:00", "2026-11-16T14:50:54+00:00", 258083.8, 258084.09),
  row("sunset", "Other", null, "2026-11-16T14:52:56+00:00", "2026-11-16T14:53:57+00:00", 258084.91, 258085.41),
  row("J25008 Los Flamboyanes", "Job", "Los Flamboyanes - Christa", "2026-11-16T15:00:04+00:00", "2026-11-16T15:27:50+00:00", 258087.3, 258087.5),
  row("VILLAGER", "Plant", "Villager City Plant", "2026-11-16T15:38:03+00:00", "2026-11-16T15:41:06+00:00", 258090.91, 258091.09),
  row("sunset", "Other", null, "2026-11-16T15:47:14+00:00", "2026-11-16T15:48:16+00:00", 258092.41, 258092.8),
  row("J25008 Los Flamboyanes", "Job", "Los Flamboyanes - Christa", "2026-11-16T15:53:23+00:00", "2026-11-16T16:14:33+00:00", 258094.7, 258094.91),
  row("VILLAGER", "Plant", "Villager City Plant", "2026-11-16T16:25:45+00:00", "2026-11-16T16:30:53+00:00", 258098.3, 258098.7),
  row("WALWDOLO", "Plant", "Walworth Dolomite Plant", "2026-11-16T16:56:23+00:00", "2026-11-16T17:08:37+00:00", 258119.09, 258120.09),
  row("J25008 Los Flamboyanes", "Job", "Los Flamboyanes - Christa", "2026-11-16T17:36:09+00:00", "2026-11-16T17:54:36+00:00", 258141.3, 258141.5),
  row("WALWDOLO", "Plant", "Walworth Dolomite Plant", "2026-11-16T18:18:02+00:00", "2026-11-16T18:29:15+00:00", 258162.7, 258163.91),
  row("J25008 Los Flamboyanes", "Job", "Los Flamboyanes - Christa", "2026-11-16T18:54:45+00:00", "2026-11-16T19:15:43+00:00", 258185.09, 258185.41),
  row("J611 Bishop Kearney", "Job", "Bishop Kearney Performance Center", "2026-11-16T19:23:53+00:00", "2026-11-16T19:33:17+00:00", 258188.91, 258189.2),
  // Open when the JSON was pulled (15:02 ET); closed at 15:41:56 in the later xlsx export. Exit odometer from the ping history (258050.59 + 142.81).
  row("J25008 Los Flamboyanes", "Job", "Los Flamboyanes - Christa", "2026-11-16T19:43:31+00:00", "2026-11-16T20:41:56+00:00", 258192.91, 258193.4),
  // From the xlsx export only: back at the shop at 16:03:25, still there at midnight. Entry odometer from the ping history (258050.59 + 161.20).
  row("SHOP", "Other", "Our shop and equipment yard", "2026-11-16T21:03:25+00:00", null, 258211.79, null),
];

const real = parseFleetEntryExit({ Result: MCK_55_17_ROWS });
const id = (code: string) => `geo:${code}`;
const JOB = id('J25008 Los Flamboyanes');
const VILLAGER = id('VILLAGER');
const WALWDOLO = id('WALWDOLO');
const J611 = id('J611 Bishop Kearney');

const assignment = (key: string, label: string, fromPlaceId: string | null, toPlaceId: string | null, extra: Partial<TripAssignment> = {}): TripAssignment => ({
  id: key,
  label,
  fromPlaceId,
  toPlaceId,
  cancelledAt: null,
  changes: [],
  ...extra,
});

export const REAL_DAY: Dataset = {
  id: 'mck-55-17-2026-11-16',
  name: 'Real: MCK-55-17, Mon 16 Nov',
  source:
    'HCSS Fleet entry/exit for MCK-55-17 (JSON pulled 15:02 ET, completed from the xlsx export), meter readings from the Supabase snapshot, ignition from the ping history. The Assignments are a guess: Dave’s real ones for that day were not shared.',
  date: real.date,
  truck: `${real.truckCode} · ${real.truckDescription}`,
  places: real.places,
  visits: real.visits,
  meter: {
    startOdometer: 258050.59,
    endOdometer: 258212.2,
    source: 'Supabase snapshots: 258,050.59 read 15 Nov 21:41 ET, 258,212.20 read 16 Nov 22:12 ET (after ignition off at 16:12:45)',
  },
  facts: [
    'Ping history: Ignition On 06:19:40, Ignition Off 16:12:45, 161.61 miles that day, a ping about every 61 s.',
    'Ping history: speed reads 0 mph for the whole drive home (15:41–16:03), so speed is never used.',
    'Supabase snapshot at 16:01 ET read 258,211.0 with the engine Active: a reading taken mid-shift.',
    'Fuel used stayed at 241.3 gal for three days: not used.',
  ],
  scenarios: [
    {
      id: 'guess',
      name: 'Two Assignments (a guess)',
      about: 'A guess at Dave’s day: J25008 → Villager, and Walworth Dolomite → J25008. Bishop Kearney fits neither.',
      assignments: [assignment('a1', 'A1', JOB, VILLAGER), assignment('a2', 'A2', WALWDOLO, JOB)],
    },
    {
      id: 'other-way',
      name: 'The other way round',
      about: 'If Villager was the pickup (Villager → J25008): the same Trips, but which ones are Loads flips.',
      assignments: [assignment('a1', 'A1', VILLAGER, JOB), assignment('a2', 'A2', WALWDOLO, JOB)],
    },
    {
      id: 'blank-to',
      name: 'A1 with no To',
      about: 'Dave left A1’s To empty. Ways back and the drive to the shop must still not count as Loads.',
      assignments: [assignment('a1', 'A1', JOB, null), assignment('a2', 'A2', WALWDOLO, JOB)],
    },
    {
      id: 'reroute',
      name: 'Reroute at 11:20',
      about: 'At 11:20 Dave changed A1’s To from Villager to Bishop Kearney. Trips before that match A1 as it was.',
      assignments: [
        assignment('a1', 'A1', JOB, J611, { changes: [{ changedAt: '2026-11-16T16:20:00Z', before: { fromPlaceId: JOB, toPlaceId: VILLAGER } }] }),
        assignment('a2', 'A2', WALWDOLO, JOB),
      ],
    },
  ],
};

export const FAKE_DAY: Dataset = {
  id: 'fake',
  name: 'Made-up names (the tests’ day)',
  source: 'shared/trips.fixture.ts: the real day’s times and odometers with made-up names, as the tests use it.',
  date: FIXTURE_DATE,
  truck: 'Sample Truck 21',
  places: FIXTURE_PLACES,
  visits: FIXTURE_VISITS,
  meter: { ...FIXTURE_METER, source: 'Made up, the same numbers as the real day' },
  facts: [],
  scenarios: FIXTURE_SCENARIOS,
};

/** A day from an uploaded HCSS entry/exit export: no meter readings, and Dave’s Assignments to be added in the page. */
export function uploadedDay(day: FleetDay, fileName: string): Dataset {
  return {
    id: `upload:${fileName}`,
    name: `Uploaded: ${day.truckCode}, ${day.date}`,
    source: `${fileName}: HCSS Fleet entry/exit, ${day.visits.length} rows. No meter readings or Assignments: add Dave’s Assignments to match against.`,
    date: day.date,
    truck: [day.truckCode, day.truckDescription].filter(Boolean).join(' · '),
    places: day.places,
    visits: day.visits,
    meter: null,
    facts: [],
    scenarios: [{ id: 'none', name: 'No Assignments yet', about: 'Add Dave’s Assignments below.', assignments: [] }],
  };
}

export const DATASETS: Dataset[] = [REAL_DAY, FAKE_DAY];
