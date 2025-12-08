// Sponsor Page JavaScript
const DEFAULT_PASSWORD = 'admin123';
const STORAGE_KEY = 'sponsorImages';
const DURATION_KEY = 'sponsorSlideDuration';
const DEFAULT_DURATION = 10; // seconds
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per image

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    initializeSponsor();
    setupEventListeners();
});

function initializeSponsor() {
    // Set default password if not exists
    if (!localStorage.getItem('adminPassword')) {
        localStorage.setItem('adminPassword', DEFAULT_PASSWORD);
    }

    // Check if already logged in (session storage)
    if (sessionStorage.getItem('adminLoggedIn') === 'true') {
        showDashboard();
    }
}

function setupEventListeners() {
    // Login
    document.getElementById('loginBtn').addEventListener('click', handleLogin);
    document.getElementById('adminPassword').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            handleLogin();
        }
    });

    // Logout
    document.getElementById('logoutBtn').addEventListener('click', handleLogout);

    // Upload
    document.getElementById('uploadBtn').addEventListener('click', function() {
        document.getElementById('imageUpload').click();
    });
    document.getElementById('imageUpload').addEventListener('change', handleImageUpload);

    // Clear all
    document.getElementById('clearAllBtn').addEventListener('click', clearAllImages);

    // Duration setting
    document.getElementById('saveDurationBtn').addEventListener('click', saveSlideDuration);
}

function handleLogin() {
    const password = document.getElementById('adminPassword').value;
    const savedPassword = localStorage.getItem('adminPassword');

    if (password === savedPassword) {
        sessionStorage.setItem('adminLoggedIn', 'true');
        showDashboard();
    } else {
        alert('Forkert adgangskode!');
        document.getElementById('adminPassword').value = '';
    }
}

function handleLogout() {
    sessionStorage.removeItem('adminLoggedIn');
    document.getElementById('loginScreen').style.display = 'block';
    document.getElementById('sponsorDashboard').style.display = 'none';
    document.getElementById('adminPassword').value = '';
}

function showDashboard() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('sponsorDashboard').style.display = 'block';
    loadSlideDuration();
    loadGallery();
}

function handleImageUpload(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const preview = document.getElementById('uploadPreview');
    preview.innerHTML = '<p style="color: #fff;">Uploader billeder...</p>';

    let processedCount = 0;
    const totalFiles = files.length;
    const images = getSponsorImages();

    Array.from(files).forEach((file, index) => {
        // Validate file type
        if (!file.type.startsWith('image/')) {
            alert(`Fil "${file.name}" er ikke et gyldigt billede`);
            processedCount++;
            checkUploadComplete(processedCount, totalFiles);
            return;
        }

        // Validate file size
        if (file.size > MAX_FILE_SIZE) {
            alert(`Fil "${file.name}" er for stor. Maksimal størrelse: 10MB`);
            processedCount++;
            checkUploadComplete(processedCount, totalFiles);
            return;
        }

        // Read and process image
        const reader = new FileReader();
        reader.onload = function(e) {
            const img = new Image();
            img.onload = function() {
                // Optional: Resize if needed (for FullHD)
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                // If image is larger than FullHD, resize it
                const maxWidth = 1920;
                const maxHeight = 1080;

                if (width > maxWidth || height > maxHeight) {
                    const ratio = Math.min(maxWidth / width, maxHeight / height);
                    width = width * ratio;
                    height = height * ratio;
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // Convert to base64 (with compression)
                const imageData = canvas.toDataURL('image/jpeg', 0.9);

                // Save image
                const imageObj = {
                    id: Date.now() + index,
                    name: file.name,
                    data: imageData,
                    uploadDate: new Date().toISOString(),
                    width: width,
                    height: height
                };

                images.push(imageObj);
                saveSponsorImages(images);

                processedCount++;
                checkUploadComplete(processedCount, totalFiles);
            };
            img.onerror = function() {
                alert(`Kunne ikke indlæse billede: ${file.name}`);
                processedCount++;
                checkUploadComplete(processedCount, totalFiles);
            };
            img.src = e.target.result;
        };
        reader.onerror = function() {
            alert(`Kunne ikke læse fil: ${file.name}`);
            processedCount++;
            checkUploadComplete(processedCount, totalFiles);
        };
        reader.readAsDataURL(file);
    });

    // Reset file input
    event.target.value = '';
}

function checkUploadComplete(processed, total) {
    if (processed === total) {
        const preview = document.getElementById('uploadPreview');
        preview.innerHTML = `<p style="color: #4CAF50;">✓ ${total} billede(r) uploadet!</p>`;
        setTimeout(() => {
            preview.innerHTML = '';
        }, 3000);
        loadGallery();
    }
}

function getSponsorImages() {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
}

function saveSponsorImages(images) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(images));
    } catch (e) {
        if (e.name === 'QuotaExceededError') {
            alert('Lagerplads opbrugt! Slet nogle billeder for at uploade flere.');
        } else {
            alert('Fejl ved gemning af billeder: ' + e.message);
        }
    }
}

function loadGallery() {
    const images = getSponsorImages();
    const galleryContainer = document.getElementById('galleryContainer');
    const emptyGallery = document.getElementById('emptyGallery');

    if (images.length === 0) {
        galleryContainer.innerHTML = '';
        emptyGallery.style.display = 'block';
        return;
    }

    emptyGallery.style.display = 'none';

    // Sort by upload date (newest first)
    images.sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));

    galleryContainer.innerHTML = images.map(img => `
        <div class="gallery-item" data-id="${img.id}">
            <div class="gallery-image-container">
                <img src="${img.data}" alt="${escapeHtml(img.name)}" class="gallery-image">
                <div class="gallery-overlay">
                    <button class="btn-view" onclick="viewImage(${img.id})">👁️ Vis</button>
                    <button class="btn-delete" onclick="deleteImage(${img.id})">🗑️ Slet</button>
                </div>
            </div>
            <div class="gallery-info">
                <div class="gallery-name">${escapeHtml(img.name)}</div>
                <div class="gallery-meta">${img.width}x${img.height} | ${formatDate(img.uploadDate)}</div>
            </div>
        </div>
    `).join('');
}

function viewImage(id) {
    const images = getSponsorImages();
    const image = images.find(img => img.id === id);
    if (!image) return;

    // Create modal to view full-size image
    const modal = document.createElement('div');
    modal.className = 'image-modal';
    modal.innerHTML = `
        <div class="image-modal-content">
            <span class="image-modal-close">&times;</span>
            <img src="${image.data}" alt="${escapeHtml(image.name)}" class="image-modal-img">
            <div class="image-modal-info">
                <p><strong>${escapeHtml(image.name)}</strong></p>
                <p>Opløsning: ${image.width}x${image.height}</p>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Close modal on click
    modal.addEventListener('click', function(e) {
        if (e.target === modal || e.target.className === 'image-modal-close') {
            document.body.removeChild(modal);
        }
    });
}

function deleteImage(id) {
    if (!confirm('Er du sikker på at du vil slette dette billede?')) {
        return;
    }

    let images = getSponsorImages();
    images = images.filter(img => img.id !== id);
    saveSponsorImages(images);
    loadGallery();
}

function clearAllImages() {
    if (!confirm('Er du sikker på at du vil slette ALLE sponsor billeder? Dette kan ikke fortrydes!')) {
        return;
    }

    if (!confirm('Dette vil permanent slette alle billeder. Er du helt sikker?')) {
        return;
    }

    localStorage.removeItem(STORAGE_KEY);
    loadGallery();
    alert('Alle sponsor billeder er blevet slettet!');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(isoString) {
    const date = new Date(isoString);
    return date.toLocaleDateString('da-DK', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function loadSlideDuration() {
    const duration = localStorage.getItem(DURATION_KEY) || DEFAULT_DURATION;
    document.getElementById('slideDuration').value = duration;
}

function saveSlideDuration() {
    const duration = parseInt(document.getElementById('slideDuration').value);

    if (isNaN(duration) || duration < 3 || duration > 60) {
        alert('Varighed skal være mellem 3 og 60 sekunder!');
        return;
    }

    localStorage.setItem(DURATION_KEY, duration.toString());
    alert(`Slideshow varighed opdateret til ${duration} sekunder!`);
}

function getSlideDuration() {
    const duration = localStorage.getItem(DURATION_KEY);
    return duration ? parseInt(duration) : DEFAULT_DURATION;
}

// Cleanup on page unload
window.addEventListener('beforeunload', function() {
    // Any cleanup if needed
});
