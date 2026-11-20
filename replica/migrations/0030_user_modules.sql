-- 6z.38: the modules each person may open, set one by one in Users & Roles. JSON such as
-- {"slk":true,"wireguard":false,"competency":true}. NULL or a missing key means the role decides.
-- Everyone reads the Knowledge Hub, so it is not stored here.
ALTER TABLE user_roles ADD COLUMN modules TEXT CHECK (modules IS NULL OR json_valid(modules));
