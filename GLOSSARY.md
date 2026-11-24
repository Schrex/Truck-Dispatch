# Trucking

How Dave plans each driver's day and how the work they actually do becomes a truck log.

## Planning

**Assignment**:
One piece of work given to one Driver for one day, e.g. haul 2" minus from Villager to TIUNY. Each is one kind of work, a Haul (the default) or a Move, and its kind decides which of its fields it uses. It covers any number of Loads. The same work for two Drivers is two Assignments, one each, made together but separate from then on. A Driver's Assignments for a day are done in an order Dave sets. Dave can cancel one; a cancelled Assignment is kept and the Driver sees it was cancelled. Each of them can then clear it out of his own view (Dave discards it, the Driver dismisses it) without hiding it from the other; it is still kept. Its day never changes once it exists. Once it is Assigned, giving it to another Driver cancels it and adds a new one for that Driver. Whether one has started or finished comes from the Truck, never from Dave or the Driver.
_Avoid_: task, order (the paper Truck log's word), work order, dispatch, dispatch order, job

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

**From the Truck**:
An Assignment Dave made afterwards from Unplanned work, saying where it loaded and the Material. It is Assigned at once, never Added, and its Driver gets no notice. The rules count only the Trips of that Unplanned work for it.

**Working day**:
A weekday that is not one of the six Holidays (New Year's Day, Memorial Day, Independence Day, Labor Day, Thanksgiving, Christmas), the same as the Daily Schedule's. The board opens on the next one. Weekends and Holidays can still be planned.

**Driver**:
A person who drives a company Truck and receives Assignments. Each has a usual Truck; an Assignment names a Truck only when the work needs a certain one, otherwise it names none ("His own") and the Driver takes his usual Truck.

**Foreman**:
The person running a Job on a given day. Changes from day to day, so an Assignment names one as its For, not a Place. An Assignment names a Foreman or a Customer as its For, never both. A job-site Place can have a usual Foreman, who is suggested as the For of a new Assignment that drops off there, or picks up there when the drop-off is not a job site, until Dave picks or types a For himself. New Foremen are added only in Settings.
_Avoid_: project lead, super

**For**:
Whose work an Assignment is: a Foreman or a Customer, one field picked from both lists ("Nate hauling for Jaus"), or typed. A typed For is a Foreman if one has that name, else a Customer, else a new Customer. Blank is allowed. A Customer is tagged "Customer" wherever For is shown.
_Avoid_: client, owner, foreman (for a Customer)

**At**:
The Place an Assignment's Truck works at, usually the Job site, when Dave says where without planning a route ("hauling for Brody at TIUNY"). Optional, picked from the Places or typed (a typed one is found, brought back or added, as a From or To is), and usable beside From and To ("at TIUNY, asphalt to Villager"). Picking a For fills an empty At with its usual Place: a Customer's usual Place, or the one active job site a Foreman is the usual Foreman of. An At Dave chose is never overwritten, and an At never suggests a For.
_Avoid_: site, location, job

**Haul**:
The usual kind of Assignment: hauling material, with a For, At, Material, From and To, each optional. Every Assignment is a Haul unless Dave picks another kind; every one made before there were kinds is a Haul. Its block and card carry a black HAUL pill.
_Avoid_: load (a Load is one trip's worth), job

**Move**:
An Assignment that moves a piece of equipment, typically on a lowboy: a machine typed as Dave writes it ("the 260 + big bucket"), with From and To, and no Material, For or At. Never counted as Loads. Its block and card carry a blue MOVE pill. Changing an Assignment between Haul and Move clears what the new kind does not use, after Dave confirms.
_Avoid_: lowboy (the trailer, not the work), transfer, haul (for a Move)

**Customer**:
Someone outside the company we haul for, e.g. Jaus; never a Foreman. Kept in Settings beside Foremen, each with an optional usual Place where their work usually is, which picking them fills in as At. No name is both a Foreman's and a Customer's (ignoring case, removed ones included).
_Avoid_: client, contractor

## Trucks

**Check-in**:
A Driver picking the Truck he is taking today and doing its Inspection, as one step. He is checked in to that Truck once the Inspection is done; taking another Truck later that day means checking in to it too. Offered only for today, whether or not Dave has Assigned him work. His latest check-in that day counts; earlier ones stay. On a Truck's day, the Driver of its latest check-in at or before a Trip was driving it then; with no check-in before a Trip, nobody is guessed ("Who was driving?").
_Avoid_: clock-in, sign-in, truck pick

**Inspection**:
A Driver's walk-around check of a Truck before taking it out that day, item by item, with what needs repair. It is the official record of the Truck's condition: once made it is never changed, only followed by a newer one.
_Avoid_: truck check, pre-trip, DVIR (in the app)

**Inspection item**:
One line of the Inspection checklist ("Lights", "Air leaks / brake pressure"), answered OK, Needs repair or N/A. The checklist is kept in Settings; an Inspection keeps each item's wording as it was that day. An Inspection with any item answered Needs repair is itself said to need repair.

**Ticket**:
The paper a plant or supplier gives the Driver for one Load. The Driver photographs it; nobody types its numbers. The tons an Assignment hauled are the tons on its Loads' Tickets.

**Truck log**:
The finished record of one Truck for one day: who drove it, its Inspection, its Trips and Loads with their Tickets, its miles and hours, and the sign-offs. Built from what the Truck, the Driver and Dave recorded; nobody types it. It replaces the paper Daily Truck Log, whose Orders are that day's Assignments.
_Avoid_: daily log, timesheet

**Total hours**:
A Truck's working time for one day, from its first start to its last stop. Worked out from the Truck, never typed.

**Trucking hours**:
The time a Truck spent on one Assignment, from leaving for its first Trip to the end of its last. Worked out from the Truck, never typed.

**Truck problem**:
Something wrong with a Truck, reported by a Driver either as a Needs repair item in an Inspection or at any time that day, always with a note saying what is wrong. It stays open until Dave marks it fixed. A Truck with an open Truck problem can still be driven: the app reports, it never grounds.
_Avoid_: issue, defect, breakdown

## Locations

**Place**:
Anywhere a Truck loads, dumps or parks: a plant, a job site, the shop, a yard.
_Avoid_: site, location, geofence

**Job**:
A construction project with a job number. A Job can have more than one Place; a Place belongs to at most one Job. An Assignment's Job is the Job of its To, then of its At, then of its From: the first that belongs to a Job.
_Avoid_: site, project

## Work

**Trip**:
One movement of a Truck from one Place to another, as the Truck records it, loaded or empty. Nobody enters Trips.
_Avoid_: run, leg

**Load**:
A Trip carrying material from a pickup Place to a drop Place. Counted from the Truck and tickets, never entered by Dave.
_Avoid_: run

**At Trip**:
A Trip that starts or ends at the At of an Assignment with no From or To. It counts toward Now / Done and Trucking hours, never toward Loads: the Truck cannot tell which way material went, and round trips cannot give a true count, so its Loads come from Tickets. With a From or a To, At fills the missing end instead and the Trips are Loads as usual.

**Unplanned work**:
Trips in a row that a Truck made and no Assignment explains, taken as one piece of work for Dave to answer: make an Assignment for it, link it to an Assignment, or say it was not a haul. The Truck cannot tell which way material went, so where it was loaded is Dave's to say.
_Avoid_: extra job, side job, unassigned trip, Trips with no Assignment

**Which Assignment?**:
A Trip that two or more of the Truck's Assignments fit equally well. It is planned work, never Unplanned work; Dave picks which Assignment it counts on.
_Avoid_: tie (in what Dave or a Driver reads)

**Trip part**:
What the Truck's Trips say about one Assignment at a moment of the day: its Loads so far, Now or Done, since when, and its Trucking hours. An Assignment has one only once a Trip counts on it.

**Geofence list** (Geofences in Settings):
Every geofence code the app knows: HCSS's Location list, and every code an Import brought. Each code is either considered or **Not considered**. A geofence code is how a visit names where the Truck was; a Place may have one.
_Avoid_: locations, fences list, Not considered list

**Not considered**:
A geofence code Dave turned off in the Geofence list because it is never work, such as a fuel stop, a diner or a road fence. A Truck's visit to it is skipped, however long it stayed, so the day reads as if the Truck drove straight past; every other visit is a stop. It applies to every Truck and every day, past ones included, and turning the code back on brings its visits back.
_Avoid_: drive-through, ignored, skipped Place

**Import**:
One Fleet export Dave drops on the Fleet imports page, with what it stored (new, closed and already stored visits). A stored day is shown as of its latest Import ("As of the Import at 16:25"), never later.
_Avoid_: upload, sync

**Material**:
What a Load carries, e.g. 2" minus, CR2, dirt, topsoil, stone.
