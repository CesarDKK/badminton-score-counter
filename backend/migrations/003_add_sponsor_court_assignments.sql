-- Add court assignments for sponsor images
-- Junction table to track which court numbers are assigned to which sponsor images

CREATE TABLE IF NOT EXISTS sponsor_image_courts (
    id INT PRIMARY KEY AUTO_INCREMENT,
    sponsor_image_id INT NOT NULL,
    court_number INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (sponsor_image_id) REFERENCES sponsor_images(id) ON DELETE CASCADE,
    UNIQUE KEY unique_court_assignment (court_number),
    INDEX idx_sponsor_image_id (sponsor_image_id),
    INDEX idx_court_number (court_number)
) ENGINE=InnoDB;

-- Note: UNIQUE KEY on court_number ensures only one image can be assigned per court
