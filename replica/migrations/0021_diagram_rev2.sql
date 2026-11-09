-- Owner request 2026-11-09: the Slickline String Diagram moves to QAF14010 Rev 2, which lists an upper and a lower
-- fishing neck per tool and has a Verified by box beside Approved by (SDM). Rows of a diagram are JSON, so only the
-- catalogue and the diagram's sign-off need columns.

ALTER TABLE parts ADD COLUMN fn_lower_in REAL CHECK (fn_lower_in IS NULL OR fn_lower_in > 0);
ALTER TABLE job_diagrams ADD COLUMN verified_by TEXT;
ALTER TABLE job_diagrams ADD COLUMN verified_at TEXT;
