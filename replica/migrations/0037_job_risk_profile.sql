-- 6z.54: Operations → Job Risk Profile, the Risk Tool and Crew Check moved out of the Competency Framework. It
-- reads the Competency data. Each role starts with the rights it has on Jobs (admins have every right already).

INSERT INTO role_permissions (id, role, menu_key, can_view, can_edit, can_delete)
SELECT lower(hex(randomblob(16))), role, 'job_risk_profile', can_view, can_edit, can_delete FROM role_permissions
WHERE menu_key = 'jobs' AND role <> 'admin'
  AND role NOT IN (SELECT role FROM role_permissions WHERE menu_key = 'job_risk_profile');
