-- Migration 052: YouTubes egen status for banens udsendelse
--
-- Nr. 40 (pakke P): LIVE-mærket på tabletten og på /live viste, at TV-PC'en
-- sender — ikke at YouTube viser udsendelsen. Udsendelsen kan stå som "ready"
-- (billedet er ikke nået frem, eller den er ikke gået live), og så er der intet
-- at se. Tjekket af udsendelsen (routes/livestream.js ytStyr, 'tjek') henter
-- allerede lifeCycleStatus; den gemmes nu her ('created', 'ready', 'testing',
-- 'liveStarting', 'live' …), så "LIVE" kun vises, når YouTube er live, og
-- ellers "Starter …". Ingen ekstra kald til YouTube.
--
-- Hører til yt_broadcast_id: ryddes, når en ny udsendelse oprettes, og bruges
-- kun, mens banen har en udsendelse.

ALTER TABLE court_streams ADD COLUMN yt_status VARCHAR(20) NULL DEFAULT NULL;
