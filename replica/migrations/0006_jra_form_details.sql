-- A JRA filled in on NESR's Excel form and uploaded: the form's header (job no, performed by, client, rig/well ...),
-- the remarks per question, and the file name, who uploaded it and when. NULL for JRAs answered on screen.
ALTER TABLE jras ADD COLUMN form_details TEXT CHECK (form_details IS NULL OR json_valid(form_details));
