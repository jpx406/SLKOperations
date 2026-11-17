-- Owner request 2026-11-17: two more Knowledge Hub sections, Standard Work Instructions (SWI) and Forms. Both are
-- filed under Global or a country and a company, like SOPs. Forms download in their original format.
-- Also: document analysis by AI when a document is added counts in AI usage as its own feature.
--
-- section is limited by a CHECK, so knowledge_docs is rebuilt again. Dropping it would cascade-delete its files
-- and revisions (ON DELETE CASCADE), so both are copied aside first and put back after, as 0012 did for tab_grants.

PRAGMA defer_foreign_keys = true;

CREATE TABLE knowledge_files_keep AS SELECT * FROM knowledge_files;
CREATE TABLE knowledge_revisions_keep AS SELECT * FROM knowledge_revisions;

CREATE TABLE knowledge_docs_new (
  id                  TEXT PRIMARY KEY,
  section             TEXT NOT NULL DEFAULT 'lesson' CHECK (section IN ('lesson','sop','swi','form','client')),
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
  origin              TEXT NOT NULL DEFAULT 'internal' CHECK (origin IN ('internal','external')),
  author              TEXT,
  expires_on          TEXT,
  is_form             INTEGER NOT NULL DEFAULT 0 CHECK (is_form IN (0,1)),
  published_at        TEXT,
  approved_by         TEXT,
  retire_reason       TEXT,
  CHECK (section <> 'lesson' OR doc_type IS NOT NULL),
  CHECK (section <> 'client' OR client IS NOT NULL),
  UNIQUE (country, source_ref)
);

INSERT INTO knowledge_docs_new (id, section, country, company, client, doc_type, category, title, summary, key_action, failure_types, published_on, rilr_ref, r2_key,
  thumbnail_r2_key, duplicate_of, lesson_of_week_from, source_ref, doc_no, revision, review_due, retired_at, retired_by, created_by, created_at, origin, author, expires_on,
  is_form, published_at, approved_by, retire_reason)
SELECT id, section, country, company, client, doc_type, category, title, summary, key_action, failure_types, published_on, rilr_ref, r2_key,
  thumbnail_r2_key, duplicate_of, lesson_of_week_from, source_ref, doc_no, revision, review_due, retired_at, retired_by, created_by, created_at, origin, author, expires_on,
  is_form, published_at, approved_by, retire_reason FROM knowledge_docs;

DROP TABLE knowledge_docs;
ALTER TABLE knowledge_docs_new RENAME TO knowledge_docs;
CREATE UNIQUE INDEX idx_knowledge_doc_no ON knowledge_docs(doc_no) WHERE doc_no IS NOT NULL;
CREATE INDEX idx_knowledge_section ON knowledge_docs(section, country);

DELETE FROM knowledge_files;
INSERT INTO knowledge_files SELECT * FROM knowledge_files_keep;
DROP TABLE knowledge_files_keep;
DELETE FROM knowledge_revisions;
INSERT INTO knowledge_revisions SELECT * FROM knowledge_revisions_keep;
DROP TABLE knowledge_revisions_keep;

-- AI usage: a third feature, the document analysis on Add document
CREATE TABLE ai_usage_new (
  id          TEXT PRIMARY KEY,
  username    TEXT NOT NULL,
  feature     TEXT NOT NULL CHECK (feature IN ('assistant','agent','document')),
  model       TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_microusd INTEGER NOT NULL DEFAULT 0,
  occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO ai_usage_new SELECT id, username, feature, model, input_tokens, output_tokens, cost_microusd, occurred_at FROM ai_usage;
DROP TABLE ai_usage;
ALTER TABLE ai_usage_new RENAME TO ai_usage;
CREATE INDEX ai_usage_user_day ON ai_usage (username, occurred_at);
CREATE INDEX ai_usage_month ON ai_usage (occurred_at);
