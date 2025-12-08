// Sponsor Page JavaScript
const api = window.BadmintonAPI;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per image
const DEFAULT_DURATION = 10; // seconds

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    initializeSponsor();
    setupEventListeners();
});

function initializeSponsor() {
    // Check if already logged in (JWT token exists)
    if (api.token) {
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

async function handleLogin() {
    const password = document.getElementById('adminPassword').value;

    if (!password) {
        alert('Indtast venligst en adgangskode!');
        return;
    }

    try {
        await api.login(password);
        showDashboard();
    } catch (error) {
        console.error('Login failed:', error);
        alert('Forkert adgangskode!');
        document.getElementById('adminPassword').value = '';
    }
}

function handleLogout() {
    api.logout();
    document.getElementById('loginScreen').style.display = 'block';
    document.getElementById('sponsorDashboard').style.display = 'none';
    document.getElementById('adminPassword').value = '';
}

async function showDashboard() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('sponsorDashboard').style.display = 'block';
    await loadSlideDuration();
    await loadGallery();
}

async function handleImageUpload(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const preview = document.getElementById('uploadPreview');
    preview.innerHTML = '<p style="color: #fff;">Uploader billeder...</p>';

    // Validate all files first
    const validFiles = [];
    let failCount = 0;

    for (const file of files) {
        // Validate file type
        if (!file.type.startsWith('image/')) {
            alert(`Fil "${file.name}" er ikke et gyldigt billede`);
            failCount++;
            continue;
        }

        // Validate file size
        if (file.size > MAX_FILE_SIZE) {
            alert(`Fil "${file.name}" er for stor. Maksimal størrelse: 10MB`);
            failCount++;
            continue;
        }

        validFiles.push(file);
    }

    if (validFiles.length === 0) {
        preview.innerHTML = `<p style="color: #e94560;">Ingen gyldige billeder at uploade</p>`;
        setTimeout(() => {
            preview.innerHTML = '';
        }, 3000);
        event.target.value = '';
        return;
    }

    try {
        // Create FormData and add all valid files
        const formData = new FormData();
        for (const file of validFiles) {
            formData.append('images', file);
        }

        preview.innerHTML = `<p style="color: #fff;">Uploader ${validFiles.length} billede(r)...</p>`;

        // Upload all images at once
        const result = await api.uploadSponsorImages(formData);

        const successCount = result.images ? result.images.length : 0;

        // Show completion message
        if (successCount > 0) {
            preview.innerHTML = `<p style="color: #4CAF50;">✓ ${successCount} billede(r) uploadet!</p>`;
        } else {
            preview.innerHTML = `<p style="color: #e94560;">Ingen billeder blev uploadet</p>`;
        }

        setTimeout(() => {
            preview.innerHTML = '';
        }, 3000);

        // Reload gallery
        await loadGallery();
    } catch (error) {
        console.error('Failed to upload images:', error);
        preview.innerHTML = `<p style="color: #e94560;">Upload fejlede: ${error.message}</p>`;
        setTimeout(() => {
            preview.innerHTML = '';
        }, 5000);
    }

    // Reset file input
    event.target.value = '';
}

async function loadGallery() {
    const galleryContainer = document.getElementById('galleryContainer');
    const emptyGallery = document.getElementById('emptyGallery');

    try {
        const images = await api.getSponsorImages();

        if (images.length === 0) {
            galleryContainer.innerHTML = '';
            emptyGallery.style.display = 'block';
            return;
        }

        emptyGallery.style.display = 'none';

        // Sort by upload date (newest first)
        images.sort((a, b) => new Date(b.upload_date) - new Date(a.upload_date));

        galleryContainer.innerHTML = images.map(img => `
            <div class="gallery-item" data-id="${img.id}">
                <div class="gallery-image-container">
                    <img src="/uploads/${img.filename}" alt="${escapeHtml(img.original_name)}" class="gallery-image">
                    <div class="gallery-overlay">
                        <button class="btn-view" onclick="viewImage(${img.id}, '${img.filename}', '${escapeHtml(img.original_name)}', ${img.width}, ${img.height})">👁️ Vis</button>
                        <button class="btn-delete" onclick="deleteImage(${img.id})">🗑️ Slet</button>
                    </div>
                </div>
                <div class="gallery-info">
                    <div class="gallery-name">${escapeHtml(img.original_name)}</div>
                    <div class="gallery-meta">${img.width}x${img.height} | ${formatDate(img.upload_date)}</div>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Failed to load gallery:', error);
        galleryContainer.innerHTML = '<p style="color: #e94560; text-align: center; padding: 40px;">Kunne ikke indlæse galleri. Tjek din forbindelse.</p>';
    }
}

function viewImage(id, filename, originalName, width, height) {
    // Create modal to view full-size image
    const modal = document.createElement('div');
    modal.className = 'image-modal';
    modal.innerHTML = `
        <div class="image-modal-content">
            <span class="image-modal-close">&times;</span>
            <img src="/uploads/${filename}" alt="${escapeHtml(originalName)}" class="image-modal-img">
            <div class="image-modal-info">
                <p><strong>${escapeHtml(originalName)}</strong></p>
                <p>Opløsning: ${width}x${height}</p>
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

async function deleteImage(id) {
    if (!confirm('Er du sikker på at du vil slette dette billede?')) {
        return;
    }

    try {
        await api.deleteSponsorImage(id);
        await loadGallery();
    } catch (error) {
        console.error('Failed to delete image:', error);
        alert('Kunne ikke slette billede. Tjek din forbindelse.');
    }
}

async function clearAllImages() {
    if (!confirm('Er du sikker på at du vil slette ALLE sponsor billeder? Dette kan ikke fortrydes!')) {
        return;
    }

    if (!confirm('Dette vil permanent slette alle billeder. Er du helt sikker?')) {
        return;
    }

    try {
        // Get all images
        const images = await api.getSponsorImages();

        // Delete each image
        for (const img of images) {
            try {
                await api.deleteSponsorImage(img.id);
            } catch (error) {
                console.error(`Failed to delete image ${img.id}:`, error);
            }
        }

        await loadGallery();
        alert('Alle sponsor billeder er blevet slettet!');
    } catch (error) {
        console.error('Failed to clear all images:', error);
        alert('Kunne ikke slette alle billeder. Tjek din forbindelse.');
    }
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

async function loadSlideDuration() {
    try {
        const settings = await api.getSponsorSettings();
        const duration = settings.slideDuration || DEFAULT_DURATION;
        document.getElementById('slideDuration').value = duration;
    } catch (error) {
        console.error('Failed to load slide duration:', error);
        document.getElementById('slideDuration').value = DEFAULT_DURATION;
    }
}

async function saveSlideDuration() {
    const duration = parseInt(document.getElementById('slideDuration').value);

    if (isNaN(duration) || duration < 3 || duration > 60) {
        alert('Varighed skal være mellem 3 og 60 sekunder!');
        return;
    }

    try {
        await api.updateSponsorSettings(duration);
        alert(`Slideshow varighed opdateret til ${duration} sekunder!`);
    } catch (error) {
        console.error('Failed to save slide duration:', error);
        alert('Kunne ikke gemme varighed. Tjek din forbindelse.');
    }
}

// Cleanup on page unload
window.addEventListener('beforeunload', function() {
    // Any cleanup if needed
});
