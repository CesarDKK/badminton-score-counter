-- Tilføj felter til device_tokens for match-session QR tokens
-- Match-session tokens bruges i klub-mode hvor TV'et viser en QR,
-- spillere scanner den med telefonen for at tælle på banen. Tokenet invalideres
-- når kampen starter eller banen ryddes.

ALTER TABLE device_tokens
ADD COLUMN token_type ENUM('permanent', 'match_session') DEFAULT 'permanent' COMMENT 'permanent = manuelt oprettet, match_session = auto-genereret QR-token per kamp' AFTER destination,
ADD COLUMN court_number INT DEFAULT NULL COMMENT 'Bane-nummer for match-session tokens' AFTER token_type,
ADD COLUMN consumed_at TIMESTAMP NULL DEFAULT NULL COMMENT 'Tidspunkt for første brug (sporing)' AFTER last_used_at,
ADD INDEX idx_court_number (court_number),
ADD INDEX idx_token_type (token_type);
