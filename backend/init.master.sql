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
  INDEX idx_subdomain (subdomain),
  INDEX idx_is_active (is_active)
) ENGINE=InnoDB;
