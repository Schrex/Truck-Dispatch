# Trucking

How Dave plans each driver's day and how the work they actually do becomes a truck log.

## Planning

**Assignment**:
One piece of work given to one Driver for one day, e.g. haul 2" minus from Villager to TIUNY. It covers any number of Loads. A Driver's Assignments for a day are done in an order Dave sets. Dave can cancel one; a cancelled Assignment is kept and the Driver sees it was cancelled. Its day never changes once it exists. Once it is Assigned, giving it to another Driver cancels it and adds a new one for that Driver. Whether one has started or finished comes from the Truck, never from Dave or the Driver.
_Avoid_: task, work order, dispatch, dispatch order, job

**Unassigned**:
An Assignment with no Driver yet. It stays a Draft: it cannot be Assigned until Dave gives it a Driver, which he does when one is free.

**Assign**:
Dave's act of giving one Assignment to its Driver. Before it the Assignment is a Draft and the Driver sees nothing of it; after it, every change Dave makes to it reaches the Driver at once. Each Assignment is Assigned on its own, never a whole day at once. Only Dave Assigns; a Driver never takes work himself.
_Avoid_: send, publish, post, dispatch

**Draft**:
An Assignment that has not been Assigned yet, with or without a Driver. Its Driver, if it has one, sees nothing of it.

**Changed**:
An Assignment that Dave altered, cancelled, put back or moved within its Driver's order after it was Assigned. The Driver sees it marked "Changed by Dave", with what it was when Assigned. Changes to a Draft mark nothing. Others that shift place because of a move are not Changed.
_Avoid_: edited, updated

**Added**:
An Assignment that Dave Assigned on its own day, or that was given to a Driver from another Driver after it was Assigned. The Driver sees it marked "Added by Dave". Work Assigned before its day is never Added.

**Working day**:
A weekday that is not one of the six Holidays (New Year's Day, Memorial Day, Independence Day, Labor Day, Thanksgiving, Christmas), the same as the Daily Schedule's. The board opens on the next one. Weekends and Holidays can still be planned.

**Driver**:
A person who drives a company Truck and receives Assignments. Each has a usual Truck; an Assignment names a Truck only when the work needs a certain one, otherwise it names none ("His own") and the Driver takes his usual Truck.

**Foreman**:
The person running a Job on a given day. Changes from day to day, so an Assignment names one, not a Place. A job-site Place can have a usual Foreman, who is suggested for new Assignments that drop off there, or pick up there when the drop-off is not a job site.
_Avoid_: project lead, super

## Trucks

**Check-in**:
A Driver picking the Truck he is taking today and doing its Inspection, as one step. He is checked in to that Truck once the Inspection is done; taking another Truck later that day means checking in to it too. Offered only for today, whether or not the Driver has Assigned work that day.
_Avoid_: clock-in, sign-in, truck pick

**Inspection**:
A Driver's walk-around check of a Truck before taking it out that day, item by item, with what needs repair. It is the official record of the Truck's condition: once made it is never changed, only followed by a newer one.
_Avoid_: truck check, pre-trip, DVIR (in the app)

**Inspection item**:
One line of the Inspection checklist ("Lights", "Air leaks / brake pressure"), answered OK, Needs repair or N/A. The checklist is kept in Settings; an Inspection keeps each item's wording as it was that day. An Inspection with any item answered Needs repair is itself said to need repair.

**Ticket**:
The paper a plant or supplier gives the Driver for one Load. The Driver photographs it; nobody types its numbers.

**Truck log**:
The finished record of one Truck for one day: who drove it, its Inspection, its Trips and Loads with their Tickets, its miles and hours, and the sign-offs. Built from what the Truck, the Driver and Dave recorded; nobody types it.
_Avoid_: daily log, timesheet

**Truck problem**:
Something wrong with a Truck, reported by a Driver either as a Needs repair item in an Inspection or at any time that day, always with a note saying what is wrong. It stays open until Dave marks it fixed. A Truck with an open Truck problem can still be driven: the app reports, it never grounds.
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
