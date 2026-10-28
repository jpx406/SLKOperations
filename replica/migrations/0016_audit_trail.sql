-- Administration → Audit trail (owner request 2026-10-28): every change and every sign-in, searchable by date,
-- person, area and action. Sign-in events (signed in, failed, signed out, timed out, refused) also keep the
-- address and the browser they came from.

ALTER TABLE audit_log ADD COLUMN ip TEXT;
ALTER TABLE audit_log ADD COLUMN user_agent TEXT;
CREATE INDEX audit_user ON audit_log (username, occurred_at);
CREATE INDEX audit_action ON audit_log (action, occurred_at);
