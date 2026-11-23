/**
 * The suite's fixed clock and screen sizes, shared by the config (which hands
 * NOW to the Worker) and the journeys (which go to the day they need).
 */

/** The Worker's "now": Monday 23 Nov 2026, 9 AM US Eastern, a Working day. */
export const NOW = '2026-11-23T14:00:00Z';
/** NOW's day in US Eastern. */
export const TODAY = '2026-11-23';

/** The Board is Dave's screen. */
export const DESKTOP = { width: 1440, height: 900 };
/** The Driver view is a Driver's phone. */
export const PHONE = { width: 390, height: 844 };
