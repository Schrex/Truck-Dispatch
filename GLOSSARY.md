# Trucking

How Dave plans each driver's day and how the work they actually do becomes a truck log.

## Planning

**Assignment**:
One piece of work given to one Driver for one day, e.g. haul 2" minus from Villager to TIUNY. It covers any number of Loads. A Driver's Assignments for a day are done in an order Dave sets. Dave can cancel one; a cancelled Assignment is kept and the Driver sees it was cancelled. Whether one has started or finished comes from the Truck, never from Dave or the Driver.
_Avoid_: task, work order, dispatch, dispatch order, job

**Driver**:
A person who drives a company Truck and receives Assignments.

**Foreman**:
The person running a Job on a given day. Changes from day to day, so an Assignment names one, not a Place. A job site can have a usual Foreman, who is suggested for new Assignments there.
_Avoid_: project lead, super

## Trucks

**Inspection**:
A Driver's walk-around check of a Truck before taking it out that day, item by item, with what needs repair. It is the official record of the Truck's condition: once made it is never changed, only followed by a newer one.
_Avoid_: truck check, pre-trip, DVIR (in the app)

**Truck problem**:
Something wrong with a Truck that a Driver reports during the day. It stays open until Dave marks it fixed.
_Avoid_: issue, defect, breakdown

## Locations

**Place**:
Anywhere a Truck loads, dumps or parks: a plant, a job site, the shop, a yard.
_Avoid_: site, location, geofence

**Job**:
A construction project with a job number. A Job can have more than one Place; a Place belongs to at most one Job.
_Avoid_: site, project

## Work

**Load**:
One trip carrying material from a pickup Place to a drop Place. Counted from the truck and tickets, never entered by Dave.
_Avoid_: trip, run

**Material**:
What a Load carries, e.g. 2" minus, CR2, dirt, topsoil, stone.
