-- 6z.40: Career Development, the Career Development Plan moved out of Competency into its own menu and module.
-- Its right is career_development. Each role starts with the same Career Development rights it has for Competency,
-- so nobody who used the plan in Competency loses it. Admins have every right already.
INSERT INTO role_permissions (id, role, menu_key, can_view, can_edit, can_delete)
SELECT lower(hex(randomblob(16))), role, 'career_development', can_view, can_edit, can_delete FROM role_permissions
WHERE menu_key = 'competency' AND role <> 'admin'
  AND role NOT IN (SELECT role FROM role_permissions WHERE menu_key = 'career_development');

-- people given or refused Competency one by one get the same for Career Development
INSERT INTO tab_grants (id, username, menu_key, effect, can_edit, granted_by)
SELECT lower(hex(randomblob(16))), username, 'career_development', effect, can_edit, 'migration 0031' FROM tab_grants
WHERE menu_key = 'competency'
  AND username NOT IN (SELECT username FROM tab_grants WHERE menu_key = 'career_development');
