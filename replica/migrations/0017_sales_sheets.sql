-- Sales dashboard → Activity sheet and Daily report (owner request 2026-10-28), replacing the two Excel workbooks.
-- Only what the app has no column for is stored here (the rest is read from the job or the unit), plus the review
-- lock: who checked a line, when, and the values it had then.

-- Activity sheet: one line per job
CREATE TABLE sales_activity (
  job_id      TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  country     TEXT NOT NULL,
  data        TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(data)),
  locked_by   TEXT,
  locked_at   TEXT,
  snapshot    TEXT CHECK (snapshot IS NULL OR json_valid(snapshot)),
  updated_by  TEXT,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK ((locked_by IS NULL) = (locked_at IS NULL))
);
CREATE INDEX sales_activity_month ON sales_activity (country, json_extract(data, '$.revenue_month'));

-- Daily report: one line per unit per day
CREATE TABLE sales_daily (
  country     TEXT NOT NULL,
  day         TEXT NOT NULL CHECK (date(day) IS NOT NULL),
  unit_number TEXT NOT NULL,
  data        TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(data)),
  locked_by   TEXT,
  locked_at   TEXT,
  snapshot    TEXT CHECK (snapshot IS NULL OR json_valid(snapshot)),
  updated_by  TEXT,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (country, day, unit_number),
  CHECK ((locked_by IS NULL) = (locked_at IS NULL))
);
CREATE INDEX sales_daily_unit ON sales_daily (unit_number, day);

-- The day itself: upcoming operations typed by hand (rigs that have no job yet) and the people on board
CREATE TABLE sales_daily_days (
  country     TEXT NOT NULL,
  day         TEXT NOT NULL CHECK (date(day) IS NOT NULL),
  data        TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(data)),
  updated_by  TEXT,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (country, day)
);

-- The sheet format each account uses (its extra columns and ticket statuses), when Sales picks one other than the
-- one its name suggests
CREATE TABLE sales_account_formats (
  country     TEXT NOT NULL,
  account     TEXT NOT NULL,
  format      TEXT NOT NULL CHECK (format IN ('standard','sawcod','nawcod','razor','dwo','unc','lstk','wireline')),
  updated_by  TEXT,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (country, account)
);
