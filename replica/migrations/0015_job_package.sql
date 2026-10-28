-- Owner request 2026-10-28.
--   jobs.service_order_no   the Service Order number, asked for when "Service order raised" is Yes.
--   jra_templates.package   a form template that is the job package: the list of documents the package must hold,
--                           uploaded to R2 under job-packages/<YYYY-MM>/<Rig-Well-Date>/ and approved by the SDM
--                           before the job can be completed. Its items can apply only when the job has a Service
--                           Order, a failure, explosives, a third party or a JRA.
--   job_forms               checklists are approved by the SDM after they are marked complete, with the time of each
--                           step, and only an admin reopens one (who and when is kept).
--   attachments             a package file records which template and item it belongs to.

ALTER TABLE jobs ADD COLUMN service_order_no TEXT;

ALTER TABLE jra_templates ADD COLUMN package INTEGER NOT NULL DEFAULT 0 CHECK (package IN (0,1));

ALTER TABLE job_forms ADD COLUMN approved_by TEXT;
ALTER TABLE job_forms ADD COLUMN approved_at TEXT;
ALTER TABLE job_forms ADD COLUMN reopened_by TEXT;
ALTER TABLE job_forms ADD COLUMN reopened_at TEXT;

ALTER TABLE attachments ADD COLUMN template_id TEXT;
ALTER TABLE attachments ADD COLUMN package_item TEXT;
CREATE INDEX attachments_package ON attachments (entity_id, template_id, package_item);
