// Player Info Page JavaScript
const api = window.BadmintonAPI;

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    initializePlayerInfo();
    setupEventListeners();
});

function initializePlayerInfo() {
    if (api.token) {
        showPlayerInfoDashboard();
    }
}

function setupEventListeners() {
    // Login
    document.getElementById('loginBtn').addEventListener('click', handleLogin);
    document.getElementById('adminPassword').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') handleLogin();
    });

    // Logout
    document.getElementById('logoutBtn').addEventListener('click', handleLogout);

    // Add Player Form
    document.getElementById('addPlayerForm').addEventListener('submit', handleAddPlayer);

    // Edit Player Modal
    const modal = document.getElementById('editPlayerModal');
    const closeBtn = modal.querySelector('.close-modal');

    closeBtn.onclick = function() {
        modal.style.display = 'none';
    };

    document.getElementById('cancelEditBtn').addEventListener('click', function() {
        modal.style.display = 'none';
    });

    window.onclick = function(event) {
        if (event.target == modal) {
            modal.style.display = 'none';
        }
    };

    document.getElementById('editPlayerForm').addEventListener('submit', handleEditPlayer);

    // Message overlay
    document.getElementById('messageOkBtn').addEventListener('click', hideMessage);

    // Confirm overlay
    document.getElementById('confirmCancelBtn').addEventListener('click', function() {
        hideConfirm(false);
    });
    document.getElementById('confirmOkBtn').addEventListener('click', function() {
        hideConfirm(true);
    });

    // XML Import
    document.getElementById('selectXmlBtn').addEventListener('click', function() {
        document.getElementById('xmlFileInput').click();
    });
    document.getElementById('xmlFileInput').addEventListener('change', handleXmlFileSelect);
    document.getElementById('importXmlBtn').addEventListener('click', handleXmlImport);
}

async function handleLogin() {
    const password = document.getElementById('adminPassword').value;

    if (!password) {
        showMessage('Fejl', 'Indtast venligst en adgangskode!');
        return;
    }

    try {
        await api.login(password);
        showPlayerInfoDashboard();
    } catch (error) {
        console.error('Login failed:', error);
        showMessage('Fejl', 'Forkert adgangskode!');
        document.getElementById('adminPassword').value = '';
    }
}

function handleLogout() {
    api.logout();
    document.getElementById('playerInfoDashboard').style.display = 'none';
    document.getElementById('loginScreen').style.display = 'block';
    document.getElementById('adminPassword').value = '';
}

async function showPlayerInfoDashboard() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('playerInfoDashboard').style.display = 'block';

    await loadPlayers();
}

async function loadPlayers() {
    const container = document.getElementById('playersListContainer');

    try {
        const players = await api.getPlayers();

        if (players.length === 0) {
            container.innerHTML = '<p style="color: #aaa;">Ingen spillere endnu. Tilføj en spiller for at komme i gang.</p>';
            return;
        }

        // Group players by age group
        const groupedPlayers = {};
        players.forEach(player => {
            if (!groupedPlayers[player.age_group]) {
                groupedPlayers[player.age_group] = [];
            }
            groupedPlayers[player.age_group].push(player);
        });

        // Render grouped players
        let html = '';
        const ageGroups = ['U9', 'U11', 'U13', 'U15', 'U17', 'U19'];

        ageGroups.forEach(ageGroup => {
            if (groupedPlayers[ageGroup] && groupedPlayers[ageGroup].length > 0) {
                html += `<div class="age-group-section">`;
                html += `<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">`;
                html += `<h4 style="color: var(--color-accent); margin: 0; font-size: 1.4em; font-weight: bold;">${ageGroup} <span style="color: #aaa; font-weight: normal; font-size: 0.85em;">(${groupedPlayers[ageGroup].length} spillere)</span></h4>`;
                html += `<button class="btn-danger" style="padding: 8px 20px; font-size: 0.9em;" onclick="deleteAgeGroup('${ageGroup}', ${groupedPlayers[ageGroup].length})">Slet alle ${ageGroup}</button>`;
                html += `</div>`;
                html += `<div class="players-table" style="overflow-x: auto;">`;
                html += `<table style="width: 100%; border-collapse: collapse;">`;
                html += `<thead>
                    <tr style="background: rgba(255,255,255,0.05); border-bottom: 2px solid var(--color-primary);">
                        <th style="padding: 12px; text-align: left; color: var(--color-accent);">Navn</th>
                        <th style="padding: 12px; text-align: left; color: var(--color-accent);">Køn</th>
                        <th style="padding: 12px; text-align: left; color: var(--color-accent);">Klub</th>
                        <th style="padding: 12px; text-align: right; color: var(--color-accent);">Handlinger</th>
                    </tr>
                </thead>`;
                html += `<tbody>`;

                groupedPlayers[ageGroup].forEach(player => {
                    html += `<tr style="border-bottom: 1px solid rgba(255,255,255,0.1);">`;
                    html += `<td style="padding: 12px;">${escapeHtml(player.name)}</td>`;
                    html += `<td style="padding: 12px;">${escapeHtml(player.gender)}</td>`;
                    html += `<td style="padding: 12px;">${escapeHtml(player.club)}</td>`;
                    html += `<td style="padding: 12px; text-align: right;">`;
                    html += `<button class="btn-secondary" style="margin-right: 10px; padding: 8px 16px;" onclick="editPlayer(${player.id})">Redigér</button>`;
                    html += `<button class="btn-danger" style="padding: 8px 16px;" onclick="deletePlayer(${player.id}, '${escapeHtml(player.name)}')">Slet</button>`;
                    html += `</td>`;
                    html += `</tr>`;
                });

                html += `</tbody></table></div></div>`;
            }
        });

        container.innerHTML = html;
    } catch (error) {
        console.error('Error loading players:', error);
        container.innerHTML = '<p style="color: #e94560;">Fejl ved indlæsning af spillere. Prøv igen.</p>';
    }
}

async function handleAddPlayer(e) {
    e.preventDefault();

    const name = document.getElementById('playerName').value.trim();
    const club = document.getElementById('playerClub').value.trim();
    const gender = document.getElementById('playerGender').value;
    const ageGroup = document.getElementById('playerAgeGroup').value;

    if (!name || !club || !gender || !ageGroup) {
        showMessage('Fejl', 'Udfyld venligst alle felter!');
        return;
    }

    try {
        await api.createPlayer({
            name: name,
            club: club,
            gender: gender,
            ageGroup: ageGroup
        });

        showMessage('Succes', 'Spiller tilføjet succesfuldt!');

        // Clear form
        document.getElementById('addPlayerForm').reset();

        // Reload players list
        await loadPlayers();
    } catch (error) {
        console.error('Error adding player:', error);
        showMessage('Fejl', error.message || 'Kunne ikke tilføje spiller. Prøv igen.');
    }
}

async function editPlayer(playerId) {
    try {
        const player = await api.getPlayer(playerId);

        document.getElementById('editPlayerId').value = player.id;
        document.getElementById('editPlayerName').value = player.name;
        document.getElementById('editPlayerClub').value = player.club;
        document.getElementById('editPlayerGender').value = player.gender;
        document.getElementById('editPlayerAgeGroup').value = player.age_group;

        document.getElementById('editPlayerModal').style.display = 'block';
    } catch (error) {
        console.error('Error loading player:', error);
        showMessage('Fejl', 'Kunne ikke indlæse spiller data.');
    }
}

async function handleEditPlayer(e) {
    e.preventDefault();

    const playerId = document.getElementById('editPlayerId').value;
    const name = document.getElementById('editPlayerName').value.trim();
    const club = document.getElementById('editPlayerClub').value.trim();
    const gender = document.getElementById('editPlayerGender').value;
    const ageGroup = document.getElementById('editPlayerAgeGroup').value;

    if (!name || !club || !gender || !ageGroup) {
        showMessage('Fejl', 'Udfyld venligst alle felter!');
        return;
    }

    try {
        await api.updatePlayer(playerId, {
            name: name,
            club: club,
            gender: gender,
            ageGroup: ageGroup
        });

        showMessage('Succes', 'Spiller opdateret succesfuldt!');

        // Close modal
        document.getElementById('editPlayerModal').style.display = 'none';

        // Reload players list
        await loadPlayers();
    } catch (error) {
        console.error('Error updating player:', error);
        showMessage('Fejl', error.message || 'Kunne ikke opdatere spiller. Prøv igen.');
    }
}

async function deletePlayer(playerId, playerName) {
    const confirmed = await showConfirm(
        'Slet Spiller',
        `Er du sikker på, at du vil slette ${playerName}?`
    );

    if (!confirmed) {
        return;
    }

    try {
        await api.deletePlayer(playerId);
        showMessage('Succes', 'Spiller slettet succesfuldt!');
        await loadPlayers();
    } catch (error) {
        console.error('Error deleting player:', error);
        showMessage('Fejl', error.message || 'Kunne ikke slette spiller. Prøv igen.');
    }
}

async function deleteAgeGroup(ageGroup, playerCount) {
    const confirmed1 = await showConfirm(
        'Slet Alle Spillere',
        `Er du sikker på, at du vil slette ALLE ${playerCount} spillere i ${ageGroup}?\n\nDette kan ikke fortrydes!`
    );

    if (!confirmed1) {
        return;
    }

    // Double confirmation for safety
    const confirmed2 = await showConfirm(
        '⚠️ ADVARSEL',
        `Dette vil permanent slette alle ${playerCount} spillere i ${ageGroup}.\n\nEr du helt sikker?`
    );

    if (!confirmed2) {
        return;
    }

    try {
        const result = await api.deletePlayersByAgeGroup(ageGroup);
        showMessage('Succes', result.message || `Alle spillere i ${ageGroup} er blevet slettet.`);
        await loadPlayers();
    } catch (error) {
        console.error('Error deleting age group:', error);
        showMessage('Fejl', error.message || 'Kunne ikke slette spillere. Prøv igen.');
    }
}

function showMessage(title, text) {
    document.getElementById('messageTitle').textContent = title;
    document.getElementById('messageText').textContent = text;
    document.getElementById('messageOverlay').style.display = 'flex';
}

function hideMessage() {
    document.getElementById('messageOverlay').style.display = 'none';
}

// Confirm dialog promise resolver
let confirmResolver = null;

function showConfirm(title, text) {
    return new Promise((resolve) => {
        confirmResolver = resolve;
        document.getElementById('confirmTitle').textContent = title;
        document.getElementById('confirmText').textContent = text;
        document.getElementById('confirmOverlay').style.display = 'flex';
    });
}

function hideConfirm(result) {
    document.getElementById('confirmOverlay').style.display = 'none';
    if (confirmResolver) {
        confirmResolver(result);
        confirmResolver = null;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// XML Import handling
let selectedXmlFile = null;

function handleXmlFileSelect(event) {
    console.log('handleXmlFileSelect called', event);
    const file = event.target.files[0];
    console.log('Selected file:', file);

    if (file && file.name.endsWith('.xml')) {
        selectedXmlFile = file;
        console.log('Valid XML file selected:', file.name);
        document.getElementById('selectedFileName').textContent = `Valgt: ${file.name}`;
        document.getElementById('selectedFileName').style.display = 'block';
        document.getElementById('importXmlBtn').disabled = false;
        console.log('Import button enabled');
        document.getElementById('importStatus').style.display = 'none';
    } else {
        console.log('Invalid file or no file selected');
        selectedXmlFile = null;
        document.getElementById('selectedFileName').style.display = 'none';
        document.getElementById('importXmlBtn').disabled = true;
        if (file) {
            showMessage('Fejl', 'Vælg venligst en .xml fil');
        }
    }
}

async function handleXmlImport() {
    console.log('handleXmlImport called');
    console.log('selectedXmlFile:', selectedXmlFile);

    if (!selectedXmlFile) {
        showMessage('Fejl', 'Vælg venligst en XML fil først');
        return;
    }

    document.getElementById('importXmlBtn').disabled = true;
    document.getElementById('importXmlBtn').textContent = 'Importerer...';
    document.getElementById('importStatus').style.display = 'block';
    document.getElementById('importStatusText').textContent = 'Læser XML fil...';
    document.getElementById('importStatusText').style.color = '#aaa';

    try {
        console.log('Starting XML parsing...');
        const xmlText = await selectedXmlFile.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

        // Check for parsing errors
        const parserError = xmlDoc.querySelector('parsererror');
        if (parserError) {
            throw new Error('XML filen kunne ikke parses korrekt');
        }

        // Parse clubs mapping
        const clubsMap = {};
        const clubs = xmlDoc.querySelectorAll('Club');
        clubs.forEach(club => {
            const clubId = club.getAttribute('clubId');
            const clubName = club.getAttribute('clubName');
            if (clubId && clubName) {
                clubsMap[clubId] = clubName;
            }
        });

        document.getElementById('importStatusText').textContent = 'Ekstrahere spillere...';

        // Parse players
        const playersToImport = [];
        const tournamentClasses = xmlDoc.querySelectorAll('TournamentClass');

        tournamentClasses.forEach(tournamentClass => {
            const ageGroup = tournamentClass.getAttribute('ageGroup');
            if (!ageGroup) return;

            // Normalize age group format (U09 -> U9, U11 -> U11, etc.)
            const normalizedAgeGroup = ageGroup.replace(/^U0?(\d+)$/, 'U$1');

            const players = tournamentClass.querySelectorAll('Player');
            players.forEach(player => {
                const firstName = player.getAttribute('firstName');
                const lastName = player.getAttribute('lastName');
                const clubId = player.getAttribute('clubId');
                const genderXml = player.getAttribute('gender'); // M or F

                if (firstName && lastName && clubId && genderXml) {
                    const fullName = `${firstName} ${lastName}`;
                    const clubName = clubsMap[clubId] || `Klub ${clubId}`;
                    // Convert M/F to Herre/Dame
                    const gender = genderXml === 'M' ? 'Herre' : genderXml === 'F' ? 'Dame' : null;

                    if (!gender) {
                        console.warn(`Invalid gender for ${fullName}: ${genderXml}`);
                        return;
                    }

                    // Check if player already exists in list
                    const exists = playersToImport.some(p =>
                        p.name === fullName && p.ageGroup === normalizedAgeGroup
                    );

                    if (!exists) {
                        playersToImport.push({
                            name: fullName,
                            club: clubName,
                            gender: gender,
                            ageGroup: normalizedAgeGroup
                        });
                    }
                }
            });
        });

        if (playersToImport.length === 0) {
            throw new Error('Ingen spillere fundet i XML filen');
        }

        document.getElementById('importStatusText').textContent = `Importerer ${playersToImport.length} spillere...`;

        // Import players to backend
        console.log('Calling api.importPlayers with', playersToImport.length, 'players');
        const result = await api.importPlayers(playersToImport);
        console.log('Import result:', result);

        document.getElementById('importStatusText').textContent = result.message || `${result.imported} spillere importeret succesfuldt! (${result.skipped} duplikater sprunget over)`;
        document.getElementById('importStatusText').style.color = 'var(--color-accent)';

        // Reset form
        selectedXmlFile = null;
        document.getElementById('xmlFileInput').value = '';
        document.getElementById('selectedFileName').style.display = 'none';
        document.getElementById('importXmlBtn').textContent = 'Importér Spillere';

        // Reload players list
        setTimeout(() => {
            loadPlayers();
        }, 2000);

    } catch (error) {
        console.error('XML import error:', error);
        document.getElementById('importStatusText').textContent = `Fejl: ${error.message}`;
        document.getElementById('importStatusText').style.color = '#e74c3c';
        document.getElementById('importXmlBtn').disabled = false;
        document.getElementById('importXmlBtn').textContent = 'Importér Spillere';
    }
}

// Make functions globally accessible for onclick handlers
window.editPlayer = editPlayer;
window.deletePlayer = deletePlayer;
window.deleteAgeGroup = deleteAgeGroup;
