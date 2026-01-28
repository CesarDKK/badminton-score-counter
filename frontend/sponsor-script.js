// Sponsor Page JavaScript
const api = window.BadmintonAPI;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per image
const DEFAULT_DURATION = 10; // seconds
let courtCount = 5; // Will be fetched from settings

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

    // Slideshow Upload
    document.getElementById('slideshowUploadBtn').addEventListener('click', function() {
        document.getElementById('slideshowImageUpload').click();
    });
    document.getElementById('slideshowImageUpload').addEventListener('change', function(e) {
        handleImageUpload(e, 'slideshow');
    });

    // Court Upload
    document.getElementById('courtUploadBtn').addEventListener('click', function() {
        document.getElementById('courtImageUpload').click();
    });
    document.getElementById('courtImageUpload').addEventListener('change', function(e) {
        handleImageUpload(e, 'court');
    });

    // Clear all buttons
    document.getElementById('clearAllSlideshowBtn').addEventListener('click', function() {
        clearAllImages('slideshow');
    });
    document.getElementById('clearAllCourtBtn').addEventListener('click', function() {
        clearAllImages('court');
    });

    // Duration setting
    document.getElementById('saveDurationBtn').addEventListener('click', saveSlideDuration);
}

async function handleLogin() {
    const password = document.getElementById('adminPassword').value;

    if (!password) {
        showMessage('Adgangskode påkrævet', 'Indtast venligst en adgangskode', [{ text: 'OK', style: 'primary' }]);
        return;
    }

    try {
        await api.login(password);
        showDashboard();
    } catch (error) {
        console.error('Login failed:', error);
        showMessage('Login fejlede', 'Forkert adgangskode', [{ text: 'OK', style: 'primary' }]);
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

    // Load court count from settings
    try {
        const settings = await api.getSettings();
        courtCount = settings.courtCount || 5;
    } catch (error) {
        console.error('Failed to load court count:', error);
        courtCount = 5; // Default fallback
    }

    await loadSlideDuration();
    await loadGalleries();
}

async function handleImageUpload(event, type) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    // Get the correct preview element based on type
    const previewId = type === 'slideshow' ? 'slideshowUploadPreview' : 'courtUploadPreview';
    const preview = document.getElementById(previewId);
    const typeName = type === 'slideshow' ? 'slideshow' : 'bane banner';

    preview.innerHTML = `<p style="color: #fff;">Uploader ${typeName} billeder...</p>`;

    // Validate all files first
    const validFiles = [];
    const errors = [];

    for (const file of files) {
        // Validate file type
        if (!file.type.startsWith('image/')) {
            errors.push(`"${file.name}" er ikke et gyldigt billede`);
            continue;
        }

        // Validate file size
        if (file.size > MAX_FILE_SIZE) {
            errors.push(`"${file.name}" er for stor (maks 10MB)`);
            continue;
        }

        validFiles.push(file);
    }

    // Show errors if any
    if (errors.length > 0) {
        showMessage('Ugyldige filer', errors.join('\n'), [{ text: 'OK', style: 'primary' }]);
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
        // Add type parameter
        formData.append('type', type);

        preview.innerHTML = `<p style="color: #fff;">Uploader ${validFiles.length} ${typeName} billede(r)...</p>`;

        // Upload all images at once
        const result = await api.uploadSponsorImages(formData);

        const successCount = result.images ? result.images.length : 0;

        // Show completion message
        if (successCount > 0) {
            preview.innerHTML = `<p style="color: #4CAF50;">✓ ${successCount} ${typeName} billede(r) uploadet!</p>`;
        } else {
            preview.innerHTML = `<p style="color: #e94560;">Ingen billeder blev uploadet</p>`;
        }

        setTimeout(() => {
            preview.innerHTML = '';
        }, 3000);

        // Reload the appropriate gallery
        await loadGallery(type);
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

async function loadGalleries() {
    await Promise.all([
        loadGallery('slideshow'),
        loadGallery('court')
    ]);
}

async function loadGallery(type) {
    const containerIdMap = {
        'slideshow': 'slideshowGalleryContainer',
        'court': 'courtGalleryContainer'
    };
    const emptyIdMap = {
        'slideshow': 'emptySlideshowGallery',
        'court': 'emptyCourtGallery'
    };

    const galleryContainer = document.getElementById(containerIdMap[type]);
    const emptyGallery = document.getElementById(emptyIdMap[type]);

    try {
        const images = await api.getSponsorImages(type);

        if (images.length === 0) {
            galleryContainer.innerHTML = '';
            emptyGallery.style.display = 'block';
            return;
        }

        emptyGallery.style.display = 'none';

        // Sort by upload date (newest first)
        images.sort((a, b) => new Date(b.upload_date) - new Date(a.upload_date));

        // Add additional CSS class for court banner items
        const itemClass = type === 'court' ? 'gallery-item gallery-item-banner' : 'gallery-item';
        const containerClass = type === 'court' ? 'gallery-image-container gallery-image-container-banner' : 'gallery-image-container';

        galleryContainer.innerHTML = images.map(img => {
            let courtCheckboxes = '';
            if (type === 'court') {
                // Generate checkboxes for court assignments
                const checkboxes = [];
                for (let i = 1; i <= courtCount; i++) {
                    const isChecked = img.assignedCourts && img.assignedCourts.includes(i) ? 'checked' : '';
                    checkboxes.push(`
                        <label class="court-checkbox">
                            <input type="checkbox"
                                   value="${i}"
                                   ${isChecked}
                                   onchange="toggleCourtAssignment(${img.id}, ${i}, this.checked)">
                            <span>Bane ${i}</span>
                        </label>
                    `);
                }
                courtCheckboxes = `
                    <div class="court-assignments">
                        <div class="court-assignments-label">Tildel til baner:</div>
                        <div class="court-checkboxes">
                            ${checkboxes.join('')}
                        </div>
                    </div>
                `;
            }

            return `
                <div class="${itemClass}" data-id="${img.id}">
                    <div class="${containerClass}">
                        <img src="/uploads/${img.filename}" alt="${escapeHtml(img.original_name)}" class="gallery-image">
                        <div class="gallery-overlay">
                            <button class="btn-view" onclick="viewImage(${img.id}, '${img.filename}', '${escapeHtml(img.original_name)}', ${img.width}, ${img.height})">👁️ Vis</button>
                            <button class="btn-delete" onclick="deleteImage(${img.id}, '${type}')">🗑️ Slet</button>
                        </div>
                    </div>
                    <div class="gallery-info">
                        <div class="gallery-name">${escapeHtml(img.original_name)}</div>
                        <div class="gallery-meta">${img.width}x${img.height} | ${formatDate(img.upload_date)}</div>
                    </div>
                    ${courtCheckboxes}
                </div>
            `;
        }).join('');
    } catch (error) {
        console.error(`Failed to load ${type} gallery:`, error);
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

async function toggleCourtAssignment(imageId, courtNumber, isChecked) {
    try {
        // Get current image data
        const images = await api.getSponsorImages('court');
        const currentImage = images.find(img => img.id === imageId);

        if (!currentImage) {
            console.error('Image not found');
            return;
        }

        // Build new court assignments array
        let newCourts = [...(currentImage.assignedCourts || [])];

        if (isChecked) {
            // Add court if not already present
            if (!newCourts.includes(courtNumber)) {
                newCourts.push(courtNumber);
            }
        } else {
            // Remove court
            newCourts = newCourts.filter(c => c !== courtNumber);
        }

        // Update court assignments on server
        await api.updateSponsorImageCourts(imageId, newCourts);

        // Reload gallery to reflect changes (including removing from other images)
        await loadGallery('court');
    } catch (error) {
        console.error('Failed to update court assignment:', error);
        showMessage('Fejl', 'Kunne ikke opdatere bane tildeling', [{ text: 'OK', style: 'primary' }]);
        // Reload to reset checkbox state
        await loadGallery('court');
    }
}

async function deleteImage(id, type) {
    showMessage(
        'Slet billede?',
        'Er du sikker på at du vil slette dette billede?',
        [
            {
                text: 'Annuller',
                style: 'secondary',
                callback: null
            },
            {
                text: 'Slet',
                style: 'danger',
                callback: async () => {
                    try {
                        await api.deleteSponsorImage(id);
                        await loadGallery(type);
                    } catch (error) {
                        console.error('Failed to delete image:', error);
                        showMessage('Fejl', 'Kunne ikke slette billede. Tjek din forbindelse', [{ text: 'OK', style: 'primary' }]);
                    }
                }
            }
        ]
    );
}

async function clearAllImages(type) {
    const typeName = type === 'slideshow' ? 'slideshow' : 'bane banner';

    // First confirmation
    showMessage(
        'Slet alle billeder?',
        `Er du sikker på at du vil slette alle ${typeName} billeder? Dette kan ikke fortrydes.`,
        [
            {
                text: 'Annuller',
                style: 'secondary',
                callback: null
            },
            {
                text: 'Fortsæt',
                style: 'danger',
                callback: () => {
                    // Second confirmation
                    showMessage(
                        'Bekræft sletning',
                        `Dette vil permanent slette alle ${typeName} billeder. Er du helt sikker?`,
                        [
                            {
                                text: 'Annuller',
                                style: 'secondary',
                                callback: null
                            },
                            {
                                text: 'Ja, slet alle',
                                style: 'danger',
                                callback: async () => {
                                    await performClearAll(type, typeName);
                                }
                            }
                        ]
                    );
                }
            }
        ]
    );
}

async function performClearAll(type, typeName) {
    try {
        // Get images of specific type
        const images = await api.getSponsorImages(type);

        if (images.length === 0) {
            showMessage('Ingen billeder', `Ingen ${typeName} billeder at slette`, [{ text: 'OK', style: 'primary' }]);
            return;
        }

        // Delete each image
        for (const img of images) {
            try {
                await api.deleteSponsorImage(img.id);
            } catch (error) {
                console.error(`Failed to delete image ${img.id}:`, error);
            }
        }

        await loadGallery(type);
        showMessage('Slettet', `Alle ${typeName} billeder er blevet slettet`, [{ text: 'OK', style: 'primary' }]);
    } catch (error) {
        console.error(`Failed to clear all ${typeName} images:`, error);
        showMessage('Fejl', 'Kunne ikke slette alle billeder. Tjek din forbindelse', [{ text: 'OK', style: 'primary' }]);
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
        showMessage('Ugyldig varighed', 'Varighed skal være mellem 3 og 60 sekunder', [{ text: 'OK', style: 'primary' }]);
        return;
    }

    try {
        await api.updateSponsorSettings(duration);
        showMessage('Gemt', `Slideshow varighed opdateret til ${duration} sekunder`, [{ text: 'OK', style: 'primary' }]);
    } catch (error) {
        console.error('Failed to save slide duration:', error);
        showMessage('Fejl', 'Kunne ikke gemme varighed. Tjek din forbindelse', [{ text: 'OK', style: 'primary' }]);
    }
}

// Message overlay functions (replaces alert/confirm dialogs)
function showMessage(title, text, buttons = [{ text: 'OK', callback: null, style: 'primary' }]) {
    const overlay = document.getElementById('messageOverlay');
    const titleElement = document.getElementById('messageTitle');
    const textElement = document.getElementById('messageText');
    const buttonsContainer = document.getElementById('messageButtons');

    titleElement.textContent = title;
    textElement.textContent = text;

    // Clear existing buttons
    buttonsContainer.innerHTML = '';

    // Add buttons
    buttons.forEach(button => {
        const btn = document.createElement('button');
        btn.textContent = button.text;
        btn.className = button.style === 'secondary' ? 'btn-secondary' : (button.style === 'danger' ? 'btn-danger' : 'btn-primary');
        btn.style.fontSize = '1.5em';
        btn.style.padding = '15px 40px';
        btn.style.cursor = 'pointer';

        btn.onclick = () => {
            hideMessage();
            if (button.callback) {
                button.callback();
            }
        };

        buttonsContainer.appendChild(btn);
    });

    overlay.style.display = 'flex';
}

function hideMessage() {
    const overlay = document.getElementById('messageOverlay');
    overlay.style.display = 'none';
}

// Cleanup on page unload
window.addEventListener('beforeunload', function() {
    // Any cleanup if needed
});
