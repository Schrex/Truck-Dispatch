# Trucking

How Dave plans each driver's day and how the work they actually do becomes a truck log.

## Planning

**Assignment**:
One piece of work given to one Driver for one day, e.g. haul 2" minus from Villager to TIUNY. It covers any number of Loads. A Driver's Assignments for a day are done in an order Dave sets. Dave can cancel one; a cancelled Assignment is kept and the Driver sees it was cancelled. Its day never changes once it exists. Once its day is Sent, giving it to another Driver cancels it and adds a new one for that Driver. Whether one has started or finished comes from the Truck, never from Dave or the Driver.
_Avoid_: task, work order, dispatch, dispatch order, job

**Unassigned**:
An Assignment with no Driver yet. Dave gives it to a Driver later.

**Send**:
Dave's act of giving a day's Assignments to the Drivers. Before it, the day is a Draft and Drivers see nothing for it; after it, every change Dave makes reaches the Drivers at once.
_Avoid_: publish, post, dispatch

**Draft**:
A day that has never been Sent. The Drivers have nothing for it yet.

**Changed**:
An Assignment that Dave altered, cancelled, put back or moved within its Driver's order after its day was Sent. The Driver sees it marked "Changed by Dave". Others that shift place because of a move are not Changed.
_Avoid_: edited, updated

**Added**:
An Assignment that Dave added to a day after it was Sent, including one given to a Driver from another Driver. The Driver sees it marked "Added by Dave".

**Working day**:
A weekday that is not one of the six Holidays (New Year's Day, Memorial Day, Independence Day, Labor Day, Thanksgiving, Christmas), the same as the Daily Schedule's. The board opens on the next one. Weekends and Holidays can still be planned.

**Driver**:
A person who drives a company Truck and receives Assignments. Each has a usual Truck; an Assignment names a Truck only when the work needs a certain one, otherwise it names none ("His own") and the Driver takes his usual Truck.

**Foreman**:
The person running a Job on a given day. Changes from day to day, so an Assignment names one, not a Place. A job-site Place can have a usual Foreman, who is suggested for new Assignments that drop off there, or pick up there when the drop-off is not a job site.
_Avoid_: project lead, super

## Trucks

**Inspection**:
A Driver's walk-around check of a Truck before taking it out that day, item by item, with what needs repair. It is the official record of the Truck's condition: once made it is never changed, only followed by a newer one.
_Avoid_: truck check, pre-trip, DVIR (in the app)

**Inspection item**:
One line of the Inspection checklist ("Lights", "Air leaks / brake pressure"), answered OK, Needs repair or N/A. The checklist is kept in Settings; an Inspection keeps each item's wording as it was that day.

**Ticket**:
The paper a plant or supplier gives the Driver for one Load. The Driver photographs it; nobody types its numbers.

**Truck log**:
The finished record of one Truck for one day: who drove it, its Inspection, its Trips and Loads with their Tickets, its miles and hours, and the sign-offs. Built from what the Truck, the Driver and Dave recorded; nobody types it.
_Avoid_: daily log, timesheet

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

**Trip**:
One movement of a Truck from one Place to another, as the Truck records it, loaded or empty. Nobody enters Trips.
_Avoid_: run, leg

**Load**:
A Trip carrying material from a pickup Place to a drop Place. Counted from the Truck and tickets, never entered by Dave.
_Avoid_: run

**Material**:
What a Load carries, e.g. 2" minus, CR2, dirt, topsoil, stone.
