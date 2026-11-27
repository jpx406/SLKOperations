-- Audit fixes (6z.68)

-- Who sent a JRA, so the sender cannot also approve it
ALTER TABLE jras ADD COLUMN sent_by TEXT;

-- One people row per WIREGUARD user. Where two rows share a username, the active one with the most job crews keeps
-- the link and the others are unlinked (they stay on the list as people).
UPDATE employees SET wg_username = NULL
WHERE wg_username IS NOT NULL
  AND id <> (
    SELECT e2.id FROM employees e2
    WHERE lower(e2.wg_username) = lower(employees.wg_username)
    ORDER BY e2.active DESC, (SELECT count(*) FROM job_crew c WHERE c.employee_id = e2.id) DESC, e2.updated_at DESC, e2.id
    LIMIT 1
  );
CREATE UNIQUE INDEX employees_wg_username ON employees (lower(wg_username)) WHERE wg_username IS NOT NULL;

-- The early Knowledge search table lost its triggers when knowledge_docs was rebuilt (0022, 0024) and nothing reads it
DROP TABLE IF EXISTS knowledge_fts;

-- Indexes lost in those rebuilds
CREATE INDEX IF NOT EXISTS kdocs_date ON knowledge_docs (country, published_on);
CREATE INDEX IF NOT EXISTS kdocs_dup ON knowledge_docs (duplicate_of);
