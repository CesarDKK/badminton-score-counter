-- Tilfoejer per-side adgangsstyring til klub-admins
-- NULL betyder fuld adgang (alle sider) for bagudkompatibilitet
-- Vaerdi er en JSON-array af side-noegler fx ["holdkamp","settings"]
ALTER TABLE club_admins ADD COLUMN page_permissions TEXT DEFAULT NULL;
