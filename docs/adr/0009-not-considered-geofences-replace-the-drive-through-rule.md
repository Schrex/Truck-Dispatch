# Not considered geofences replace the 2-minute drive-through rule

The Trip builder used to drop any closed visit shorter than 2 minutes as a drive-through and keep every longer one as a stop, and a Trip into a visit was not written until that visit had lasted 2 minutes. Tuned on the 16 Nov day, the rule was wrong both ways on real days: a 4-minute fuel stop (GAS STATION on 23 Nov) was kept, so the drive from it to the job site fitted no Assignment and became Unplanned work, while a quick dump at a real Place could be dropped. A time limit cannot tell a quick dump from a drive-by, so tuning it only moves the problem.

Dave knows which fences are never work, so he says so once: a **Not considered** list of geofence codes in Settings, a list like the others (trimmed, unique ignoring case, removed rather than deleted). The Trip builder takes the list as an input and drops every visit to a code on it before Trips are built, however long the Truck stayed ("Not considered: GAS STATION"). **Only the list decides**: the 2-minute rule is removed, a visit to any other fence is a stop however short, and a Trip counts as soon as the Truck arrives (the Trip log's "waiting" kind is gone). The list is read as it is now for every day, past ones included, so putting a code on it or taking it off re-reads every day and loses nothing: the visits stay stored. The Simulation passes "sunset" as not considered, so its 16 Nov day reads as before.

## Considered Options

- **Tune the time limit (or make it per Place).** Rejected: no limit separates a fuel stop from a quick dump; it only moves which real days are wrong.
- **Keep the 2-minute rule as well as the list.** Rejected: a real stop under 2 minutes would still vanish, and two rules make it hard to say why a visit was skipped.
- **Mark the codes on Places instead of a separate list.** Rejected: a fuel stop or road fence is not a Place Dave plans with, and it would clutter every picker.
- **Per-Truck or per-day lists, or a list frozen per day.** Rejected for now: a fence that is never work is never work, and a past day that re-reads when the list changes is what Dave wants when he adds a code he forgot.
- **Answer each such Trip as "Not a haul".** Not instead: that stays for one-off stops on one day; the list is for fences that are never work.
