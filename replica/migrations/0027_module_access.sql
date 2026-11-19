-- 6z.33: module access. After sign-in a person picks the SLK Operations Hub, the Knowledge Hub or Competency.
-- The new right slk_ops opens the whole hub. Every role that has rights today keeps it, so nobody loses access.
INSERT INTO role_permissions (id, role, menu_key, can_view, can_edit, can_delete)
SELECT lower(hex(randomblob(16))), role, 'slk_ops', 1, 0, 0 FROM role_permissions
WHERE role <> 'admin' AND role NOT IN (SELECT role FROM role_permissions WHERE menu_key = 'slk_ops')
GROUP BY role;
