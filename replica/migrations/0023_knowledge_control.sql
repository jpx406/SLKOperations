-- Owner request 2026-11-17: the Document Control features in the Knowledge Hub, so all control is done here.
-- Every document goes through review and approval: draft, in review (a reviewer), awaiting approval (an approver),
-- then published. The published revision stays live while the next one is worked on. Sent back returns it to draft
-- with the reason. Approval sets the next review to 12 months later. Retiring needs a reason and keeps the entry
-- in the archive. Reference manuals are an uncontrolled folder library beside the controlled documents.

ALTER TABLE knowledge_docs ADD COLUMN origin TEXT NOT NULL DEFAULT 'internal' CHECK (origin IN ('internal','external'));
ALTER TABLE knowledge_docs ADD COLUMN author TEXT;
ALTER TABLE knowledge_docs ADD COLUMN expires_on TEXT;
ALTER TABLE knowledge_docs ADD COLUMN is_form INTEGER NOT NULL DEFAULT 0 CHECK (is_form IN (0,1));
ALTER TABLE knowledge_docs ADD COLUMN published_at TEXT;
ALTER TABLE knowledge_docs ADD COLUMN approved_by TEXT;
ALTER TABLE knowledge_docs ADD COLUMN retire_reason TEXT;

-- entries made before this point were already in use: they count as published at their current revision
UPDATE knowledge_docs SET published_at = created_at;

CREATE TABLE knowledge_revisions (
  id               TEXT PRIMARY KEY,
  doc_id           TEXT NOT NULL REFERENCES knowledge_docs(id) ON DELETE CASCADE,
  revision         INTEGER NOT NULL CHECK (revision >= 0),
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','approval','approved','superseded','discarded')),
  change_note      TEXT,
  author           TEXT,
  revision_date    TEXT,
  expires_on       TEXT,
  created_by       TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  submitted_by     TEXT,
  submitted_at     TEXT,
  reviewer         TEXT,
  reviewed_at      TEXT,
  review_comment   TEXT,
  approver         TEXT,
  approved_at      TEXT,
  approve_comment  TEXT,
  sent_back_by     TEXT,
  sent_back_at     TEXT,
  sent_back_reason TEXT,
  UNIQUE (doc_id, revision)
);
CREATE INDEX idx_knowledge_revisions_status ON knowledge_revisions(status, reviewer, approver);

INSERT INTO knowledge_revisions (id, doc_id, revision, status, change_note, created_by, approved_at)
SELECT lower(hex(randomblob(16))), id, revision, 'approved', 'In use before document control', created_by, created_at FROM knowledge_docs;

INSERT OR IGNORE INTO knowledge_revisions (id, doc_id, revision, status, change_note, created_by)
SELECT DISTINCT lower(hex(randomblob(16))), f.doc_id, f.revision, 'superseded', f.change_note, f.uploaded_by
FROM knowledge_files f JOIN knowledge_docs d ON d.id = f.doc_id WHERE f.revision < d.revision;

-- a file now belongs to its revision: an older revision's document file is that revision's file, not a replaced one
UPDATE knowledge_files SET superseded_at = NULL
WHERE kind = 'published' AND revision < (SELECT d.revision FROM knowledge_docs d WHERE d.id = knowledge_files.doc_id);

-- who reviews and who approves (admins always can)
CREATE TABLE knowledge_people (
  username    TEXT PRIMARY KEY COLLATE NOCASE,
  can_review  INTEGER NOT NULL DEFAULT 0 CHECK (can_review IN (0,1)),
  can_approve INTEGER NOT NULL DEFAULT 0 CHECK (can_approve IN (0,1)),
  updated_by  TEXT,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- numbering, review and expiry periods
CREATE TABLE knowledge_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL CHECK (json_valid(value)),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE knowledge_manual_folders (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE knowledge_manual_files (
  id           TEXT PRIMARY KEY,
  folder_id    TEXT NOT NULL REFERENCES knowledge_manual_folders(id) ON DELETE CASCADE,
  file_name    TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  sha256       TEXT NOT NULL,
  r2_key       TEXT NOT NULL,
  uploaded_by  TEXT NOT NULL,
  uploaded_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  removed_at   TEXT,
  removed_by   TEXT
);
CREATE INDEX idx_knowledge_manual_files ON knowledge_manual_files(folder_id, removed_at);
