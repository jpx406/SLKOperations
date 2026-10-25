-- SLK Operations D1 migration 0003 - attendance code JO (Field Bonus without Food)
-- 0001 listed the code as '30', a misreading of the manual's legend. SQLite can't change a CHECK in place,
-- so the table is rebuilt and any rows carried over with '30' become 'JO'.

CREATE TABLE attendance_entries_new (
  id          TEXT PRIMARY KEY,
  country     TEXT NOT NULL,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  day         TEXT NOT NULL CHECK (date(day) IS NOT NULL),
  code        TEXT NOT NULL CHECK (code IN ('P','A','AL','SL','UL','EL','PL','HL','MAL','JBFS','JO','FA','JBOF','TR','JBOFS')),
  updated_by  TEXT,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (employee_id, day)
);

INSERT INTO attendance_entries_new (id, country, employee_id, day, code, updated_by, updated_at)
SELECT id, country, employee_id, day, CASE code WHEN '30' THEN 'JO' ELSE code END, updated_by, updated_at FROM attendance_entries;

DROP TABLE attendance_entries;
ALTER TABLE attendance_entries_new RENAME TO attendance_entries;
CREATE INDEX attendance_day ON attendance_entries (country, day);
