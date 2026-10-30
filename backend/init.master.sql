-- ====================================
-- BADMINTON MASTER DATABASE SCHEMA
-- Bruges kun i MULTI_TENANT=true mode
-- ====================================

CREATE DATABASE IF NOT EXISTS badminton_master
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE badminton_master;

-- Giv den normale bruger adgang til master databasen
GRANT ALL PRIVILEGES ON badminton_master.* TO 'badminton_user'@'%';
FLUSH PRIVILEGES;

-- Super admins (systemadministratorer der kan oprette klubber)
CREATE TABLE IF NOT EXISTS super_admins (
  id INT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Klubber
CREATE TABLE IF NOT EXISTS clubs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(200) NOT NULL,
  subdomain VARCHAR(100) UNIQUE NOT NULL,
  db_name VARCHAR(100) UNIQUE NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_login_at TIMESTAMP NULL DEFAULT NULL,
  last_login_user VARCHAR(100) NULL DEFAULT NULL,
  last_auto_backup_at TIMESTAMP NULL DEFAULT NULL,
  last_auto_backup_error VARCHAR(500) NULL DEFAULT NULL,
  INDEX idx_subdomain (subdomain),
  INDEX idx_is_active (is_active)
) ENGINE=InnoDB;

-- Skærmenes hændelser (stod stille, uden forbindelse, startet forfra, væk) i 30 dage
CREATE TABLE IF NOT EXISTS skaerm_haendelser (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  klub VARCHAR(100) NOT NULL,
  klient_id VARCHAR(40) NOT NULL,
  navn VARCHAR(60) NULL,
  side VARCHAR(10) NOT NULL DEFAULT 'tv',
  bane INT NULL,
  token_id INT NULL,
  type VARCHAR(20) NOT NULL,
  fra TIMESTAMP(3) NOT NULL,
  til TIMESTAMP(3) NULL,
  sek INT NULL,
  tekst VARCHAR(300) NULL,         -- TV-PC'ens egen rapport (pc-brat, pc-panik …)
  log MEDIUMTEXT NULL,             -- uddrag af PC'ens log
  oprettet TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_klub_fra (klub, fra),
  INDEX idx_fra (fra)
) ENGINE=InnoDB;

-- Serverens egne indstillinger (fx YouTube-login-klienten, secret'en krypteret)
CREATE TABLE IF NOT EXISTS indstillinger (
  noegle VARCHAR(60) PRIMARY KEY,
  vaerdi TEXT NULL,
  opdateret TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Centralt klub-logo-bibliotek (delt paa tvaers af alle klubber, kun superadmin)
CREATE TABLE IF NOT EXISTS club_logos (
  id INT PRIMARY KEY AUTO_INCREMENT,
  club_name VARCHAR(150) NOT NULL,
  aliases TEXT NULL,
  filename VARCHAR(255) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  file_size INT NOT NULL,
  width INT NULL,
  height INT NULL,
  mime_type VARCHAR(50) NOT NULL,
  upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_club_name (club_name)
) ENGINE=InnoDB;
