-- Company copies of global NESR SOPs and SWIs (6z.21).
-- A SAPESCO or Gulf Energy copy is its own document, filed under its company, that points at the NESR document it
-- was made from and the NESR revision it follows. The company templates live in knowledge_settings (key copies).
ALTER TABLE knowledge_docs ADD COLUMN copy_of TEXT REFERENCES knowledge_docs(id);
ALTER TABLE knowledge_docs ADD COLUMN copy_of_revision INTEGER;
-- one live copy per company of each NESR document
CREATE UNIQUE INDEX knowledge_docs_copy ON knowledge_docs(copy_of, company) WHERE copy_of IS NOT NULL AND retired_at IS NULL;
