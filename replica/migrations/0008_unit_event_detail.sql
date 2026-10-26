-- The schedule's two event types, as in the WL Operations Hub: a maintenance event carries its type
-- (Cable Maintenance, Mechanic ...), a unit status event (loan, transferred, junk, backup on location)
-- may be open-ended, stored with ends_on = '9999-12-31' and shown as "ongoing".
ALTER TABLE unit_events ADD COLUMN detail TEXT;
