// Sponsor Page JavaScript
const api = window.BadmintonAPI;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per image
const DEFAULT_DURATION = 10; // seconds
let courtCount = 5; // Will be fetched from settings
let isUpdatingCourtAssignment = false; // Track if court assignment save is in progress
const galleryImageCache = {}; // id -> billede, til viewImage-opslag uden navne i onclick

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    initializeSponsor();
    setupEventListeners();
});

function initializeSponsor() {
    if (api.token) {
        showDashboard();
    }
    showDeviceTokensNavIfClubAdmin();
}

async function showDeviceTokensNavIfClubAdmin() {
    try {
        const mode = await api.getMode();
        if (mode.mode === 'club' && api.isClubAdminSession()) {
            const btn = document.getElementById('deviceTokensNavBtn');
            if (btn) btn.style.display = 'inline-block';
        }
    } catch {}
}

function setupEventListeners() {
    // Login
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) {
        loginBtn.addEventListener('click', handleLogin);
    }
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
        console.error('[Sponsor] Login failed:', error);
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
        console.error('[Sponsor] Failed to load court count:', error);
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
        preview.innerHTML = `<p style="color: var(--color-danger, #d92c3f);">Ingen gyldige billeder at uploade</p>`;
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

        // Fremskridts-bar under upload (procent fra XHR upload.onprogress).
        // Ved 100 % skifter teksten til "Behandler…" mens serveren kører sharp.
        preview.innerHTML = `
            <p style="color: #fff; margin-bottom: 8px;" id="uploadProgressLabel">Uploader ${validFiles.length} ${typeName} billede(r)… 0%</p>
            <div style="height: 8px; background: rgba(255,255,255,0.12); border-radius: 4px; overflow: hidden;">
                <div id="uploadProgressBar" style="height: 100%; width: 0%; background: var(--color-accent, #e94560); transition: width 0.15s ease;"></div>
            </div>`;

        const onProgress = (pct) => {
            const bar = document.getElementById('uploadProgressBar');
            const label = document.getElementById('uploadProgressLabel');
            if (bar) bar.style.width = `${pct}%`;
            if (label) {
                label.textContent = pct >= 100
                    ? `Behandler ${validFiles.length} ${typeName} billede(r)…`
                    : `Uploader ${validFiles.length} ${typeName} billede(r)… ${pct}%`;
            }
        };

        // Upload all images at once
        const result = await api.uploadSponsorImages(formData, onProgress);

        const successCount = result.images ? result.images.length : 0;

        // Show completion message
        if (successCount > 0) {
            preview.innerHTML = `<p style="color: var(--color-win, #45d17e);">✓ ${successCount} ${typeName} billede(r) uploadet!</p>`;
        } else {
            preview.innerHTML = `<p style="color: var(--color-danger, #d92c3f);">Ingen billeder blev uploadet</p>`;
        }

        setTimeout(() => {
            preview.innerHTML = '';
        }, 3000);

        // Reload the appropriate gallery
        await loadGallery(type);
    } catch (error) {
        console.error('Failed to upload images:', error);
        preview.innerHTML = `<p style="color: var(--color-danger, #d92c3f);">Upload fejlede: ${error.message}</p>`;
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
        // Admin panel should see all images including inactive ones
        const images = await api.getSponsorImages(type, true);

        if (images.length === 0) {
            galleryContainer.innerHTML = '';
            emptyGallery.style.display = 'block';
            return;
        }

        emptyGallery.style.display = 'none';

        // Sort by upload date (newest first)
        images.sort((a, b) => new Date(b.upload_date) - new Date(a.upload_date));

        // Cache til viewImage-opslag — filnavn/originalnavn må ikke interpoleres
        // i onclick-strenge (brugerstyret filnavn kan bryde/injecte JS dér)
        images.forEach(img => { galleryImageCache[img.id] = img; });

        galleryContainer.innerHTML = images.map(img => {
            let courtCheckboxes = '';
            let statusControls = '';

            // Build item classes based on type and status
            let itemClass = 'gallery-item';
            let containerClass = 'gallery-image-container';

            // Add type-specific classes
            if (type === 'court') {
                itemClass += ' gallery-item-banner';
                containerClass += ' gallery-image-container-banner';
            }

            // Add inactive/expired class for visual dimming (applies to both types)
            // Also used for status controls below
            const now = new Date();
            const expirationDate = img.expiration_date ? new Date(img.expiration_date) : null;
            const isExpired = expirationDate && expirationDate <= now;

            if (isExpired) {
                itemClass += ' gallery-item-expired';
            } else if (!img.is_active) {
                itemClass += ' gallery-item-inactive';
            }

            // Add status controls for both slideshow AND court images
            // (using now, expirationDate, isExpired declared above)

            // Determine status badge
            let statusBadge = '';
            if (isExpired) {
                statusBadge = '<span class="status-badge status-expired">Udløbet</span>';
            } else if (img.is_active) {
                statusBadge = '<span class="status-badge status-active">Aktiv</span>';
            } else {
                statusBadge = '<span class="status-badge status-inactive">Inaktiv</span>';
            }

            // Format expiration date for datetime-local input (YYYY-MM-DDTHH:MM)
            // Convert from UTC to local time for display
            let expirationValue = '';
            if (expirationDate) {
                // expirationDate is a Date object in UTC
                // We need to format it as local time for the datetime-local input
                const year = expirationDate.getFullYear();
                const month = String(expirationDate.getMonth() + 1).padStart(2, '0');
                const day = String(expirationDate.getDate()).padStart(2, '0');
                const hours = String(expirationDate.getHours()).padStart(2, '0');
                const minutes = String(expirationDate.getMinutes()).padStart(2, '0');
                expirationValue = `${year}-${month}-${day}T${hours}:${minutes}`;
            }

            // Disable toggle if expired
            const toggleDisabled = isExpired ? 'disabled' : '';
            const toggleChecked = img.is_active && !isExpired ? 'checked' : '';

            // Display text depends on type
            const displayText = type === 'court' ? 'Vis på baner:' : 'Vis på TV:';
            const expiredNotice = type === 'court'
                ? 'Dette billede er udløbet og vises ikke på baner'
                : 'Dette billede er udløbet og vises ikke på TV';

            statusControls = `
                <div class="image-status-controls">
                    ${statusBadge}
                    ${isExpired ? `<div class="expiration-notice">${expiredNotice}</div>` : ''}
                    <div class="toggle-container">
                        <label class="toggle-label">
                            <span>${displayText}</span>
                            <label class="toggle-switch">
                                <input type="checkbox"
                                       ${toggleChecked}
                                       ${toggleDisabled}
                                       onchange="toggleImageActive(${img.id}, this.checked, '${type}')">
                                <span class="toggle-slider"></span>
                            </label>
                        </label>
                    </div>
                    <div class="expiration-container">
                        <label class="expiration-label">
                            <span>Udløbsdato (valgfri):</span>
                            <div class="expiration-input-wrapper">
                                <input type="datetime-local"
                                       class="expiration-input"
                                       value="${expirationValue}"
                                       onchange="setImageExpiration(${img.id}, this.value, '${type}')">
                                ${expirationValue ? `<button class="btn-clear-expiration" onclick="clearImageExpiration(${img.id}, event, '${type}')" title="Ryd udløbsdato">&times;</button>` : ''}
                            </div>
                        </label>
                    </div>
                </div>
            `;

            // Add court-specific checkboxes AFTER status controls
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
                            <button class="btn-view" onclick="viewImage(${img.id})">👁️ Vis</button>
                            <button class="btn-delete" onclick="deleteImage(${img.id}, '${type}')">🗑️ Slet</button>
                        </div>
                    </div>
                    <div class="gallery-info">
                        <div class="gallery-name">${escapeHtml(img.original_name)}</div>
                        <div class="gallery-meta">${img.width}x${img.height} | ${formatDate(img.upload_date)}</div>
                    </div>
                    ${statusControls}
                    ${courtCheckboxes}
                </div>
            `;
        }).join('');
    } catch (error) {
        console.error(`Failed to load ${type} gallery:`, error);
        galleryContainer.innerHTML = '<p style="color: var(--color-danger, #d92c3f); text-align: center; padding: 40px;">Kunne ikke indlæse galleri. Tjek din forbindelse.</p>';
    }
}

function viewImage(id) {
    const img = galleryImageCache[id];
    if (!img) return;
    const { filename, original_name: originalName, width, height } = img;
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

    // Close modal on click with proper cleanup
    const closeModal = (e) => {
        if (e.target === modal || e.target.className === 'image-modal-close') {
            modal.removeEventListener('click', closeModal);
            if (modal.parentNode) {
                document.body.removeChild(modal);
            }
        }
    };

    modal.addEventListener('click', closeModal);
}

async function toggleImageActive(imageId, isActive, type) {
    try {
        await api.toggleSponsorImageActive(imageId, isActive);
        // Reload gallery to reflect changes
        await loadGallery(type);
    } catch (error) {
        console.error('Failed to toggle image active status:', error);
        showMessage('Fejl', 'Kunne ikke opdatere aktiv status', [{ text: 'OK', style: 'primary' }]);
        // Reload to reset toggle state
        await loadGallery(type);
    }
}

async function setImageExpiration(imageId, dateTimeValue, type) {
    try {
        // Convert datetime-local value to ISO string
        // datetime-local gives us local time (e.g., "2026-02-01T18:00")
        // We need to interpret this as local time and convert to ISO
        let expirationDate = null;

        if (dateTimeValue) {
            // Parse as local time and convert to ISO string
            // Add seconds and timezone offset to ensure correct interpretation
            const localDate = new Date(dateTimeValue);
            // Create ISO string: converts local time to UTC properly
            expirationDate = localDate.toISOString();
        }

        await api.setSponsorImageExpiration(imageId, expirationDate);
        // Reload gallery to reflect changes
        await loadGallery(type);
    } catch (error) {
        console.error('Failed to set expiration date:', error);
        let errorMessage = 'Kunne ikke sætte udløbsdato';
        if (error.message.includes('fremtiden')) {
            errorMessage = 'Udløbsdato skal være i fremtiden';
        }
        showMessage('Fejl', errorMessage, [{ text: 'OK', style: 'primary' }]);
        // Reload to reset input state
        await loadGallery(type);
    }
}

async function clearImageExpiration(imageId, event, type) {
    event.preventDefault();
    event.stopPropagation();

    try {
        await api.setSponsorImageExpiration(imageId, null);
        // Reload gallery to reflect changes
        await loadGallery(type);
    } catch (error) {
        console.error('Failed to clear expiration date:', error);
        showMessage('Fejl', 'Kunne ikke rydde udløbsdato', [{ text: 'OK', style: 'primary' }]);
        // Reload to reset state
        await loadGallery(type);
    }
}

async function toggleCourtAssignment(imageId, courtNumber, isChecked) {
    // Prevent race conditions: if already updating, ignore this click
    if (isUpdatingCourtAssignment) {
        console.log('Court assignment update already in progress, ignoring click');
        return;
    }

    try {
        // Set flag and disable all court checkboxes to prevent concurrent updates
        isUpdatingCourtAssignment = true;
        setCourtCheckboxesDisabled(true);

        // Get current image data (include inactive images for admin panel)
        const images = await api.getSponsorImages('court', true);
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
    } finally {
        // Always re-enable checkboxes and clear flag when done
        isUpdatingCourtAssignment = false;
        setCourtCheckboxesDisabled(false);
    }
}

/**
 * Enable or disable all court assignment checkboxes
 * Used to prevent race conditions during court assignment updates
 * @param {boolean} disabled - Whether to disable the checkboxes
 */
function setCourtCheckboxesDisabled(disabled) {
    // .court-checkbox er <label>-elementet — vælg selve <input> indeni, ellers
    // gør .disabled ingenting og checkboxene forbliver klikbare under en opdatering.
    const checkboxes = document.querySelectorAll('.court-checkbox input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
        checkbox.disabled = disabled;
        // Add visual feedback - slightly fade out when disabled (label = parent)
        const label = checkbox.closest('.court-checkbox');
        if (label) {
            label.style.opacity = disabled ? '0.5' : '1';
            label.style.cursor = disabled ? 'not-allowed' : 'pointer';
        }
    });
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

        // Slet parallelt og hold øje med fejl — så vi ikke melder "alle slettet"
        // hvis nogle reelt fejlede (før blev fejl kun logget til konsollen).
        const results = await Promise.allSettled(
            images.map(img => api.deleteSponsorImage(img.id))
        );
        const failed = results.filter(r => r.status === 'rejected').length;

        await loadGallery(type);

        if (failed === 0) {
            showMessage('Slettet', `Alle ${typeName} billeder er blevet slettet`, [{ text: 'OK', style: 'primary' }]);
        } else {
            showMessage('Delvist slettet', `${images.length - failed} af ${images.length} ${typeName} billeder blev slettet. ${failed} fejlede — prøv igen.`, [{ text: 'OK', style: 'primary' }]);
        }
    } catch (error) {
        console.error(`Failed to clear all ${typeName} images:`, error);
        showMessage('Fejl', 'Kunne ikke slette alle billeder. Tjek din forbindelse', [{ text: 'OK', style: 'primary' }]);
    }
}

// escapeHtml and formatDate moved to utils.js
const escapeHtml = window.BadmintonUtils.escapeHtml;
const formatDate = window.BadmintonUtils.formatDate;

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
// Besked-overlay er nu delt i js/utils.js (samme markup + adfærd)
const showMessage = window.BadmintonUtils.showMessage;
const hideMessage = window.BadmintonUtils.hideMessage;

// Cleanup on page unload — pagehide (ikke beforeunload) bevarer browserens bfcache
window.addEventListener('pagehide', function() {
    // Any cleanup if needed
});
