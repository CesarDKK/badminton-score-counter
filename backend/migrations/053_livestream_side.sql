-- Migration 053: Livestream får sin egen side-rettighed (nr. 21a, pakke S)
--
-- Før fulgte siden Livestream rettigheden "devicetokens" (Adgangslinks): den,
-- der måtte oprette adgangslinks, kunne også styre livestreamen, og omvendt.
-- Nu har Livestream sin egen nøgle, 'livestream'.
--
-- Ingen må miste adgang ved deployet: en klub-admin med en begrænset liste, der
-- indeholder 'devicetokens', får 'livestream' med — så alle, der kan åbne
-- Livestream i dag, stadig kan bagefter. NULL (alle sider) er urørt og omfatter
-- den nye side af sig selv. Derefter kan super-admin skille de to ad.
--
-- Idempotent: kun lister uden 'livestream'. club_admins er ikke i klubbens
-- backup, så en gendannelse rører ikke rettighederne (config/dataMigrationer.js).

UPDATE club_admins
   SET page_permissions = JSON_ARRAY_APPEND(page_permissions, '$', 'livestream')
 WHERE page_permissions IS NOT NULL
   AND JSON_VALID(page_permissions)
   AND JSON_TYPE(page_permissions) = 'ARRAY'
   AND JSON_CONTAINS(page_permissions, '"devicetokens"')
   AND NOT JSON_CONTAINS(page_permissions, '"livestream"');
