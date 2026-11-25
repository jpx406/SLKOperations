-- 6z.57: Lessons and best practices written in the app (Utilities). Each row is one lesson learnt or best practice
-- on a company template, from draft through review and approval. The page content is JSON (sections, layout
-- choices, pictures), pictures and the failure report are kept in R2 under lessons/<id>/. On approval it is
-- published to the Knowledge Hub as a lesson entry (kb_doc_id) with its PDF and PowerPoint, and the row keeps the
-- number and revision it was published as. A new revision of an approved one goes back to draft on the same row.

CREATE TABLE lessons (
  id               TEXT PRIMARY KEY,
  kind             TEXT NOT NULL CHECK (kind IN ('lesson_learnt','best_practice')),
  company          TEXT NOT NULL CHECK (company IN ('NESR','SAPESCO','Gulf Energy')),
  country          TEXT NOT NULL,
  title            TEXT NOT NULL,
  content          TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(content)),
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','approval','approved')),
  reviewer         TEXT,
  approver         TEXT,
  submit_note      TEXT,
  review_comment   TEXT,
  sent_back_reason TEXT,
  sent_back_by     TEXT,
  submitted_by     TEXT,
  submitted_at     TEXT,
  reviewed_at      TEXT,
  approved_at      TEXT,
  source_name      TEXT,
  source_key       TEXT,
  kb_doc_id        TEXT,
  doc_no           TEXT,
  revision         INTEGER,
  change_note      TEXT,
  created_by       TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by       TEXT,
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX lessons_country ON lessons (country, status);
CREATE INDEX lessons_kb ON lessons (kb_doc_id);
