-- Owner request 2026-11-17: "Present to the crew" shows detailed slides made from the document, and each document
-- has a mind map to consult during the job without reading it again. Both are made once per published revision
-- by AI from the document file and kept here, so later views cost nothing and open at once.

CREATE TABLE knowledge_digests (
  doc_id    TEXT NOT NULL REFERENCES knowledge_docs(id) ON DELETE CASCADE,
  revision  INTEGER NOT NULL CHECK (revision >= 0),
  slides    TEXT NOT NULL CHECK (json_valid(slides)),
  mindmap   TEXT NOT NULL CHECK (json_valid(mindmap)),
  source    TEXT NOT NULL,
  model     TEXT NOT NULL,
  made_by   TEXT NOT NULL,
  made_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (doc_id, revision)
);
