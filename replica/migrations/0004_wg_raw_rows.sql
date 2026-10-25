-- SLK Operations D1 migration 0004 - keep WIREGUARD's raw rows for drums and alerts
-- The ported wire KPIs read the same objects WIREGUARD's dashboard reads (drum active flag and unit,
-- alert resolved date), so the full upstream row is kept as it already is for wires, runs and documents.

ALTER TABLE wg_drums ADD COLUMN raw TEXT CHECK (raw IS NULL OR json_valid(raw));
ALTER TABLE wg_notifications ADD COLUMN raw TEXT CHECK (raw IS NULL OR json_valid(raw));
ALTER TABLE wg_notifications ADD COLUMN resolved_at TEXT;
