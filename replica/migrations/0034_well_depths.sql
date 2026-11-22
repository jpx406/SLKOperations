-- 6z.49: Preparation asks where the minimum restriction is and at what depth the well is most deviated. The jobs
-- table is at D1's column limit, so both live in job_extras with the other late job fields.
ALTER TABLE job_extras ADD COLUMN min_restriction_depth_ft REAL;
ALTER TABLE job_extras ADD COLUMN max_deviation_depth_ft REAL;
