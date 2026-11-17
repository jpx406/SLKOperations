-- Owner request 2026-11-17: the Knowledge Hub in three sections (lessons and best practices, SLK SOPs, client
-- procedures), each filed under a country or Global, SOPs also under a company and client procedures under a client.
-- Each entry keeps its document file and an editable version in R2, with revisions as in Document Control:
-- a document number, the current revision, a review date, retired instead of deleted.
--
-- doc_type was limited to the three lesson types by a CHECK, which SQLite cannot change in place, so the table is
-- rebuilt and the existing lessons are copied across as section 'lesson'.

PRAGMA defer_foreign_keys = true;

CREATE TABLE knowledge_docs_new (
  id                  TEXT PRIMARY KEY,
  section             TEXT NOT NULL DEFAULT 'lesson' CHECK (section IN ('lesson','sop','client')),
  country             TEXT NOT NULL,
  company             TEXT,
  client              TEXT,
  doc_type            TEXT CHECK (doc_type IS NULL OR doc_type IN ('lesson_learnt','best_practice','learning_from_incident')),
  category            TEXT,
  title               TEXT NOT NULL,
  summary             TEXT,
  key_action          TEXT,
  failure_types       TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(failure_types)),
  published_on        TEXT,
  rilr_ref            TEXT,
  r2_key              TEXT,
  thumbnail_r2_key    TEXT,
  duplicate_of        TEXT REFERENCES knowledge_docs_new(id) ON DELETE SET NULL,
  lesson_of_week_from TEXT,
  source_ref          TEXT,
  doc_no              TEXT,
  revision            INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  review_due          TEXT,
  retired_at          TEXT,
  retired_by          TEXT,
  created_by          TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (section <> 'lesson' OR doc_type IS NOT NULL),
  CHECK (section <> 'client' OR client IS NOT NULL),
  UNIQUE (country, source_ref)
);

INSERT INTO knowledge_docs_new (id, section, country, doc_type, category, title, summary, key_action, failure_types, published_on, rilr_ref,
  r2_key, thumbnail_r2_key, duplicate_of, lesson_of_week_from, source_ref)
SELECT id, 'lesson', country, doc_type, category, title, summary, key_action, failure_types, published_on, rilr_ref,
  r2_key, thumbnail_r2_key, duplicate_of, lesson_of_week_from, source_ref FROM knowledge_docs;

DROP TABLE knowledge_docs;
ALTER TABLE knowledge_docs_new RENAME TO knowledge_docs;

CREATE UNIQUE INDEX idx_knowledge_doc_no ON knowledge_docs(doc_no) WHERE doc_no IS NOT NULL;
CREATE INDEX idx_knowledge_section ON knowledge_docs(section, country);

-- One row per file ever uploaded. kind 'published' is the document everyone downloads, 'source' the editable
-- version only admins see. A replaced file keeps its row and object, with superseded_at set.
CREATE TABLE knowledge_files (
  id            TEXT PRIMARY KEY,
  doc_id        TEXT NOT NULL REFERENCES knowledge_docs(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('published','source')),
  revision      INTEGER NOT NULL CHECK (revision >= 0),
  file_name     TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  sha256        TEXT NOT NULL,
  r2_key        TEXT NOT NULL,
  change_note   TEXT,
  uploaded_by   TEXT NOT NULL,
  uploaded_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  superseded_at TEXT
);
CREATE INDEX idx_knowledge_files_doc ON knowledge_files(doc_id, kind, superseded_at);
