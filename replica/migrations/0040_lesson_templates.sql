-- 6z.58: a lesson or best practice can use its own template (a .pptx brought in for it) instead of the company's
-- one from the Knowledge Hub settings. The file is kept in R2 under lessons/<id>/template/. Empty means the
-- company template.
ALTER TABLE lessons ADD COLUMN template_key TEXT;
ALTER TABLE lessons ADD COLUMN template_name TEXT;
