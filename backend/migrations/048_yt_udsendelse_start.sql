-- Migration 048: hvornår banens YouTube-udsendelse begyndte
--
-- YouTube lukker ikke længere udsendelser selv (et kort udfald på TV-PC'en
-- skal blive i samme video), så serveren vogter dem (routes/livestream.js
-- ytVagt): en udsendelse afsluttes, når PC'en har været tavs i 10 minutter,
-- når banen ikke skal sende mere — og senest efter 11 timer eller ved midnat,
-- også med PC'en i live (YouTube gemmer kun udsendelser under 12 timer som
-- video). Til de to sidste skal serveren kende starttiden. Sættes ved
-- oprettelsen og ryddes sammen med yt_broadcast_id.

ALTER TABLE court_streams ADD COLUMN yt_broadcast_start TIMESTAMP NULL DEFAULT NULL;
