# UI standards

Every page is built the same way, so Dave and the Drivers learn one app, not four pages. A new page or control follows these; a change to them is made here first. The look itself (colours, type, radius) is the Hub's ([ADR 0002](../adr/0002-match-the-hub-ui-stack.md)); elevation and motion are added beside it in `src/index.css`.

## The header (`PageHeader`)

| Place | What goes there | Never |
|---|---|---|
| Hi-vis stripe | Across the top of every page | Anything else decorative |
| Top left | **← Hub**, the one way out of the app | Replaced by a page's own back button |
| Title | The app or page name, Oswald uppercase (Dispatch, Settings, Simulation) | A changing value |
| Under the title | What the page shows ("Tue, Nov 24 · Tomorrow"), or who is using it, with the way to change it (the Driver view: initials, name, **Change**) | Navigation to another page |
| Right | Going to another view or page, in this order: **Scheduler \| Driver**, then the page's own controls, then an outline button named for where it goes (**Settings**, **Board**) | Icons without words |
| Below | What needs the full width (the Board's week strip) | |

## Moving around

- **Leaving the app**: ← Hub, top left, everywhere.
- **Between the two views** (Dave's and a Driver's): the Scheduler | Driver toggle. The device remembers it.
- **To a page that serves a view** (Settings from the Board): an outline button with an icon and the page's name; that page has the same kind of button back (**Board**).
- **Within a page** (days, weeks): arrows that name where they go ("Mon 23"), under or beside the header, plus quick picks (week tiles; Yesterday | Today | Tomorrow).
- **Who is using it**: shown under the title, with **Change**; never top left.

## Controls

- Every tap target is at least 44 px (`h-11`); the Driver view's are larger, for gloves and a cab.
- A choice between a few options is a segmented toggle: a muted track, the chosen one filled yellow with a shadow (Scheduler | Driver, the Driver's days).
- A list to pick from is chips (`rounded-full`); a picked chip is yellow.
- An action on a card sits in its bottom right corner (Assign, Discard), busy with a spinner until the Worker answers.
- Destructive actions say what they do (Cancel, Delete, Discard, Remove), and Remove asks first.

## Surfaces and states

- A card (`Card`, `shadow-sm`) holds one thing: a lane, a section, a Driver's Assignment. Tappable cards lift on hover (`lift`); what is open or chosen glows yellow (`shadow-glow`).
- State colours mean the same everywhere: dashed outline on an Assignment = Draft (elsewhere a dashed line only marks something not there yet: an empty state, Unassigned, a + to add); amber = Changed, or Unplanned work for Dave to answer; an outlined pill = From the Truck (an Assignment Dave made afterwards from Unplanned work; Assigned, never Added); green = Added or Assigned; red = cancelled or a Truck problem; yellow = chosen, Now, or go.
- People are shown by their initials in a yellow circle (lanes, Who are you?, the Driver view's header); Unassigned is a dashed ring.
- Empty states are a dashed box saying what is missing ("Nothing planned yet"), loading is a spinner with "Loading …", a failure is red text saying what failed and when it tries again.

## Motion

- Things that appear rise in (`animate-rise`, lists staggered by `--i`); panels unfold (`animate-unfold`); buttons press in slightly.
- Motion never carries meaning on its own, and is off under `prefers-reduced-motion`.
