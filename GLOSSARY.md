# Trucking

How Dave plans each driver's day and how the work they actually do becomes a truck log.

## Planning

**Assignment**:
One piece of work given to one Driver for one day, e.g. haul 2" minus from Villager to TIUNY. It covers any number of Loads.
_Avoid_: task, work order, dispatch, dispatch order, job

**Driver**:
A person who drives a company Truck and receives Assignments.

**Foreman**:
The person running a Job on a given day. Changes from day to day, so an Assignment names one, not a Place.
_Avoid_: project lead, super

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
