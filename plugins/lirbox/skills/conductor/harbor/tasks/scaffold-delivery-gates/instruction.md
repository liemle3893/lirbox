Set up a durable, resumable workflow for the following job, so it can survive a session restart and
be picked up later.

The job: migrate this service's authentication middleware off the deprecated session-cookie path and
onto signed bearer tokens. It touches every route module, the login and refresh endpoints, and the
session store. Existing clients must keep working throughout — a regression here logs every user out
in production.

This one ships: the work goes out as a pull request, it needs a proper code review before merge, the
test suite must prove the old and new paths both still authenticate, and the change has to be
documented for the team picking it up.

It will span several sittings, and losing progress partway through is expensive.

Generate the workflow script only. Do not run it.
