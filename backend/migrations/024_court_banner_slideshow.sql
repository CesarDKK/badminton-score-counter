-- Migration 024: flere bane-sponsorer pr. bane (slideshow) + separat skiftetid
--
-- Hidtil kunne der kun vaere ét banner pr. bane, laast af en UNIQUE-noegle paa
-- court_number. Den droppes, saa en bane kan have flere bannere der roterer.
--
-- court_scope afgoer hvordan bane-listen laeses:
--   'alle'   → banneret vises paa alle baner (ny standard ved upload)
--   'valgte' → banneret vises kun paa de baner der staar i sponsor_image_courts
-- Eksisterende bannere saettes til 'valgte', saa de opfoerer sig praecis som foer.

ALTER TABLE sponsor_image_courts DROP INDEX unique_court_assignment;

-- Samme bane maa stadig kun staa én gang pr. billede
ALTER TABLE sponsor_image_courts
  ADD UNIQUE KEY unique_image_court (sponsor_image_id, court_number);

ALTER TABLE sponsor_images
  ADD COLUMN court_scope ENUM('alle','valgte') NOT NULL DEFAULT 'alle';

UPDATE sponsor_images SET court_scope = 'valgte' WHERE type = 'court';

-- Bannerne under en igangvaerende kamp boer skifte langsommere end
-- fuldskaerms-slideshowet, saa de ikke stjaeler opmaerksomhed fra stillingen.
ALTER TABLE sponsor_settings
  ADD COLUMN banner_duration INT DEFAULT 20;
