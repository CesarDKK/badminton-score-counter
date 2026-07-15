// TV Display Script V3 - Minimalist layout with set score boxes
const api = window.BadmintonAPI;

const urlParams = new URLSearchParams(window.location.search);
const courtId = parseInt(urlParams.get('id') || urlParams.get('court')) || 1;

let refreshInterval = null;
let slideshowInterval = null;
let screensaverAnimFrame = null;
let currentSlideIndex = 0;
let isShowingSlideshow = false;
let cachedSponsorImages = [];
let cachedCourtBanner = null;
let cachedSlideDuration = 10000;
let timerInterval = null;
let isMatchCurrentlyActive = false;
let wasMatchPreviouslyActive = false;
// Logo-lister caches én gang (hold-logoer del C + spiller-logoer C2)
let _tvLogos = null;
let _tvPlayerLogos = null;
let _tvClubByName = null;
// Track original player names to keep consistent TV display
let originalPlayer1Name = null;
let originalPlayer1Name2 = null;
let originalPlayer2Name = null;
let originalPlayer2Name2 = null;
let matchStartTime = null;
let matchEndTime = null;
// Rest break timer tracking
let restBreakInterval = null;
let localRestBreakSecondsLeft = 0;
let isRestBreakActive = false;
let wasRestBreakActive = false; // Track previous rest break state
// Cache scores we see during gameplay as fallback until database history updates
let cachedSetScores = {
    team1: { set1: 0, set2: 0, set3: 0 },
    team2: { set1: 0, set2: 0, set3: 0 }
};
// QR counter — kun aktiv i klub-mode; vises når banen er ledig, gemmes når kampen starter
let qrCounterEnabled = false;
let qrCounterVisible = false;
let qrCounterMode = null; // 'idle' | 'resume' | null

// Initialize
document.addEventListener('DOMContentLoaded', async function() {
    await initializeTVDisplay();
    setupPlayerNameAutoFit();
    // Marquee-funktionen er midlertidigt slaaet fra mens UX'en revurderes.
    // compactDisplayName (vis kun foerste 1-2 navne) er stadig aktiv.
    // setupPlayerNameMarquee();
    loadCourtData();
    startAutoRefresh();
    startLocalTimer();
    // Sponsorer/logoer/settings/tema opdateres nu via SSE-config-events (push).
    // Et langsomt sikkerhedsnet (5 min) selvheler ved missede events (SSE-
    // reconnect-huller) og fanger super-admins centrale logo-ændringer, som
    // ikke pushes pr. tenant. Erstatter den gamle 10 s-sponsor-timer.
    setInterval(() => {
        refreshSponsorSettings();
        invalidateTvLogoCache();
        scheduleCourtDataLoad();
    }, 5 * 60 * 1000);
});

// Nulstil logo-caches så de hentes på ny ved næste render (fx efter et
// 'logos'-config-event eller sikkerhedsnettets tick).
function invalidateTvLogoCache() {
    _tvLogos = null;
    _tvPlayerLogos = null;
    _tvClubByName = null;
}

// Reager på et SSE config-event (hjælpe-data ændret et andet sted end game-state)
async function handleTvConfigEvent(scope) {
    if (scope === 'sponsors') {
        await refreshSponsorSettings();
    } else if (scope === 'logos') {
        invalidateTvLogoCache();
        scheduleCourtDataLoad(); // gen-render med friske logoer
    } else if (scope === 'theme') {
        if (window.loadTheme) await window.loadTheme();
    } else if (scope === 'settings') {
        // hideTvQr / courtCount kan være ændret — genlæs settings + gen-render
        try {
            const settings = await api.getSettings();
            const qrParam = urlParams.get('qr');
            qrCounterEnabled = !!(await (await fetch('/api/mode')).json()).qrCounter
                && qrParam !== '0' && !settings.hideTvQr;
        } catch {}
        scheduleCourtDataLoad();
    }
}

async function initializeTVDisplay() {
    document.getElementById('courtNumber').textContent = courtId;

    // Spørg backend om QR-counter funktionen er tilgængelig (kun i klub-mode).
    // Ud over mode-flaget kan tokenet have slået QR fra via admin-siden;
    // det flag kommer med som &qr=0/1 på URL'en fra /t/:token redirect.
    const qrParam = urlParams.get('qr');
    const qrAllowedByToken = qrParam !== '0'; // default ON hvis param mangler (fx direkte TV-adgang)
    try {
        const modeResp = await fetch('/api/mode');
        const modeData = await modeResp.json();
        qrCounterEnabled = !!modeData.qrCounter && qrAllowedByToken;
    } catch (e) {
        qrCounterEnabled = false;
    }

    try {
        const settings = await api.getSettings();
        if (settings.hideTvQr) qrCounterEnabled = false;
    } catch (e) { /* behold eksisterende qrCounterEnabled ved fejl */ }

    try {
        const settings = await api.getSettings();
        const courtCount = settings.courtCount;

        if (courtId < 1 || courtId > courtCount) {
            document.querySelector('.tv-container').innerHTML = `
                <div style="display: flex; align-items: center; justify-content: center; height: 100vh; flex-direction: column; gap: 20px;">
                    <h1 style="font-size: 4em; color: var(--color-accent);">Bane ${courtId} Ikke Fundet</h1>
                    <a href="landing.html" style="color: #fff; font-size: 2em; text-decoration: underline;">Tilbage til Landingsside</a>
                </div>
            `;
        }

        await refreshSponsorSettings();
    } catch (error) {
        console.error('Failed to initialize TV display:', error);
    }
}

// Med SSE er polling kun et sikkerhedsnet; uden SSE polles som hidtil
const FALLBACK_POLL_MS = 2000;
const SAFETY_POLL_MS = 15000;
let liveUpdatesHandle = null;

function startAutoRefresh() {
    startPolling(FALLBACK_POLL_MS);

    if (window.LiveUpdates) {
        liveUpdatesHandle = window.LiveUpdates.connect({
            court: courtId,
            onEvent: (event) => {
                // Config-events (sponsorer/logoer/settings/tema) håndteres målrettet;
                // alt andet er en game-state-poke → hent frisk banestilstand.
                if (event && event.type === 'config') {
                    handleTvConfigEvent(event.scope);
                } else {
                    scheduleCourtDataLoad();
                }
            },
            onStateChange: (connected) => startPolling(connected ? SAFETY_POLL_MS : FALLBACK_POLL_MS)
        });
    }
}

function startPolling(ms) {
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(scheduleCourtDataLoad, ms);
}

// Saml hurtige SSE-events/poll-ticks til een fetch ad gangen — kommer der
// events mens en fetch koerer, hentes der praecis een gang til bagefter
let _loadRunning = false;
let _loadPending = false;
async function scheduleCourtDataLoad() {
    if (_loadRunning) {
        _loadPending = true;
        return;
    }
    _loadRunning = true;
    try {
        await loadCourtData();
    } finally {
        _loadRunning = false;
        if (_loadPending) {
            _loadPending = false;
            scheduleCourtDataLoad();
        }
    }
}

function startLocalTimer() {
    // 500 ms-tick så et sekundskifte aldrig springes over ved interval-jitter;
    // DOM'en opdateres kun når det viste tal faktisk ændrer sig
    timerInterval = setInterval(function() {
        if (isMatchCurrentlyActive) {
            updateTimerDisplay();
        }
    }, 500);
}

/* ── Kamp-timer: server-forankret og monotonisk ──
   TV'ets eget ur kan være skævt ift. serverens (og tælleren, der startede
   kampen) — så i stedet for at regne "lokal tid minus starttid" ankres
   visningen i serverens elapsedSeconds og tælles videre lokalt med
   performance.now(), som er monotonisk og ikke kan hoppe. Re-ankres kun
   ved drift > 1,5 sek. så tallet ikke flimrer ved hver dataopdatering. */
let timerAnchor = null; // { base: sekunder, at: performance.now(), frozen: bool }

function anchoredElapsedSeconds() {
    if (!timerAnchor) return null;
    if (timerAnchor.frozen) return Math.max(0, Math.floor(timerAnchor.base));
    return Math.max(0, Math.floor(timerAnchor.base + (performance.now() - timerAnchor.at) / 1000));
}

function syncTimerAnchor(gameState) {
    if (!gameState.matchStartTime) {
        timerAnchor = null;
        return;
    }
    let serverElapsed = (typeof gameState.elapsedSeconds === 'number') ? gameState.elapsedSeconds : null;
    if (serverElapsed === null) {
        // Ældre backend uden elapsedSeconds — fald tilbage til dato-math, men clamp ≥ 0
        const end = gameState.matchEndTime ? new Date(gameState.matchEndTime) : new Date();
        serverElapsed = Math.max(0, (end - new Date(gameState.matchStartTime)) / 1000);
    }
    const frozen = !!gameState.matchEndTime;
    if (timerAnchor && timerAnchor.frozen === frozen && !frozen) {
        const local = anchoredElapsedSeconds();
        if (local !== null && Math.abs(local - serverElapsed) <= 1.5) return; // behold glat lokal tælling
    }
    timerAnchor = { base: serverElapsed, at: performance.now(), frozen };
}

function updateTimerDisplay() {
    const timerElement = document.getElementById('timerDisplay');
    if (!timerElement) return;

    const elapsedSeconds = anchoredElapsedSeconds() ?? 0;

    const hours = Math.floor(elapsedSeconds / 3600);
    const minutes = Math.floor((elapsedSeconds % 3600) / 60);
    const seconds = elapsedSeconds % 60;

    if (hours > 0) {
        timerElement.textContent =
            `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    } else {
        timerElement.textContent =
            `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
}

// Tæller på hinanden følgende fetch-fejl. Ét blip (fx flaky hal-wifi) må ikke
// rive stillingen ned og skifte til sponsor-slideshow — vi beholder sidste
// kendte skærmbillede og viser en diskret "forbindelse mistet"-badge, indtil
// flere forsøg i træk fejler.
let _loadFailCount = 0;
const LOAD_FAILS_BEFORE_SLIDESHOW = 4; // ved ~2s poll ≈ 8s tolerance

async function loadCourtData() {
    try {
        const gameState = await api.getGameState(courtId);

        // Succesfuldt hentet — nulstil fejltæller og skjul evt. forbindelsesbadge
        _loadFailCount = 0;
        setTvConnectionLost(false);

        // Vis kampen paa TV saa snart navne er sat — selv foer is_active flippes,
        // saa holdkamp/turneringskamp/admin-redigering rammer skaermen straks.
        const hasRealPlayerNames =
            (gameState.player1 && gameState.player1.name && gameState.player1.name !== 'Spiller 1') ||
            (gameState.player2 && gameState.player2.name && gameState.player2.name !== 'Spiller 2');

        const isMatchActive = gameState.isActive === true || hasRealPlayerNames;

        // Check if there's any game activity OR if a serving player has been selected
        const hasGameActivity =
            gameState.player1.score > 0 ||
            gameState.player2.score > 0 ||
            gameState.player1.games > 0 ||
            gameState.player2.games > 0 ||
            gameState.timerSeconds > 0 ||
            gameState.servingPlayer != null ||  // Serving player selected (singles)
            gameState.servingTeam != null;      // Serving team selected (doubles)

        isMatchCurrentlyActive = isMatchActive && hasGameActivity;

        // Hold-logoer (kun holdkamp-delkampe) — fire-and-forget, fejl skjuler logoer
        updateTvTeamLogos(gameState, isMatchActive);

        if (!isMatchActive) {
            matchStartTime = null;
            matchEndTime = null;
            timerAnchor = null;
            isMatchCurrentlyActive = false;
            wasMatchPreviouslyActive = false;
            hideRestBreak();

            // Når banen netop er ryddet beholder vi resultatet i 5 min — backend
            // leverer et snapshot her indtil det udløber eller en ny kamp overtager.
            // Banen er reelt LEDIG imens, så vis idle-QR'en oven på resultatet:
            // så kan næste par scanne og starte en ny kamp med det samme i stedet
            // for at vente på at snapshottet udløber.
            if (gameState.lastFinishedMatch) {
                showFinishedSnapshot(gameState.lastFinishedMatch);
                showQrCounter('idle');
                return;
            }

            originalPlayer1Name = null;
            originalPlayer1Name2 = null;
            originalPlayer2Name = null;
            originalPlayer2Name2 = null;
            hideMatchFinished();
            showSponsorSlideshow();
            showQrCounter('idle');
            return;
        }

        // Detect new match starting
        if (isMatchActive && !wasMatchPreviouslyActive) {
            console.log('[TV V3] New match detected - storing original player positions');

            // If set history exists, use it to determine the true original positions.
            // This handles the case where the TV page loads mid-match after sides have switched.
            const history = gameState.setScoresHistory;
            if (history && history.length > 0 && typeof history[0] === 'object' && history[0].player1Name) {
                originalPlayer1Name = history[0].player1Name;
                originalPlayer1Name2 = history[0].player1Name2 || null;
                originalPlayer2Name = history[0].player2Name;
                originalPlayer2Name2 = history[0].player2Name2 || null;
                console.log('[TV V3] Using set history for original positions:', originalPlayer1Name, 'vs', originalPlayer2Name);
            } else {
                originalPlayer1Name = gameState.player1.name;
                originalPlayer1Name2 = gameState.player1.name2 || null;
                originalPlayer2Name = gameState.player2.name;
                originalPlayer2Name2 = gameState.player2.name2 || null;
            }

            // Reset cached scores for new match
            cachedSetScores = {
                team1: { set1: 0, set2: 0, set3: 0 },
                team2: { set1: 0, set2: 0, set3: 0 }
            };

            // Reset rest break tracker
            wasRestBreakActive = false;

            if (window.loadTheme) {
                await window.loadTheme();
            }
            wasMatchPreviouslyActive = true;
        }

        hideSponsorSlideshow();

        // Check if players have been swapped
        const playersSwapped = originalPlayer1Name &&
                               gameState.player1.name === originalPlayer2Name;

        // Check if match is finished
        const matchFinished = gameState.player1.games >= 2 || gameState.player2.games >= 2;

        if (matchFinished) {
            showMatchFinished(gameState, playersSwapped);
            // Kampen er afgjort men banen ikke ryddet: vis "SCAN FOR NY KAMP"-QR
            // med det samme (kun hvis banen kører i QR-selvbetjening) — så et nyt
            // par kan gå i gang uden at nogen først skal trykke "Ryd bane".
            showQrCounter('finished');
            return;
        } else {
            hideMatchFinished();
        }

        // Check for rest break
        if (gameState.restBreakActive) {
            hideQrCounter(); // pause-overlay dækker skærmen — skjul QR imens
            showRestBreak(gameState.restBreakSecondsLeft, gameState.restBreakTitle, gameState, playersSwapped);
        } else {
            hideRestBreak();
            // Aktivt spil: vis kompakt "genoptag"-QR hvis banen kører i QR-selvbetjening
            showQrCounter('resume');
        }

        // Detect when rest break ends (timer disappears)
        // This is the perfect time to refresh data from database
        // because backend has finished saving setScoresHistory by then
        if (wasRestBreakActive && !gameState.restBreakActive) {
            console.log('[TV V3] Rest break ended. Refreshing data from database to get updated set scores...');

            // Immediately fetch fresh data from database
            setTimeout(async () => {
                try {
                    const freshGameState = await api.getGameState(courtId);
                    console.log(`[TV V3] Fresh data after rest break. setScoresHistory length: ${freshGameState.setScoresHistory?.length || 0}`);

                    // Re-determine swap status
                    const freshPlayersSwapped = originalPlayer1Name && freshGameState.player1.name === originalPlayer2Name;

                    // Update display with fresh data from database
                    updateSetScores(freshGameState, freshPlayersSwapped);
                } catch (error) {
                    console.error('[TV V3] Failed to refresh data after rest break:', error);
                }
            }, 100); // Small delay just to ensure database transaction is committed
        }

        // Track rest break state for next iteration
        wasRestBreakActive = gameState.restBreakActive;

        // Update display elements with v3 layout
        updatePlayerNames(gameState, playersSwapped);
        updateSetScores(gameState, playersSwapped);
        updateServingHighlight(gameState, playersSwapped);

        // Update match timing
        matchStartTime = gameState.matchStartTime;
        matchEndTime = gameState.matchEndTime;
        syncTimerAnchor(gameState);

        updateTimerDisplay();
        updateCourtBanner();
    } catch (error) {
        console.error('Failed to load court data:', error);
        _loadFailCount++;
        // Behold sidste kendte skærmbillede og vis en diskret badge. Først når
        // flere forsøg i træk fejler antager vi et reelt udfald og falder tilbage
        // til slideshow (så en tom/frossen skærm ikke bare står med gammel score).
        setTvConnectionLost(true);
        if (_loadFailCount >= LOAD_FAILS_BEFORE_SLIDESHOW) {
            showSponsorSlideshow();
        }
    }
}

// Diskret "forbindelse mistet"-badge på TV — bygges/vises on demand, så den
// ikke kræver ændringer i alle tv-v3.html varianter.
let _tvConnBadge = null;
function setTvConnectionLost(lost) {
    if (lost) {
        if (!_tvConnBadge) {
            _tvConnBadge = document.createElement('div');
            _tvConnBadge.id = 'tvConnectionBadge';
            _tvConnBadge.textContent = '⚠ Forbindelse mistet';
            // Farver fra --color-warning-tokenet (styles.css) i stedet for
            // hårdkodede literaler — holder tema-reglen for TV-fladen.
            _tvConnBadge.style.cssText =
                'position:fixed;bottom:16px;left:16px;z-index:9000;padding:8px 16px;' +
                'border-radius:999px;background:rgba(var(--color-warning-rgb),0.15);' +
                'border:1px solid rgba(var(--color-warning-rgb),0.5);color:var(--color-warning);' +
                'font-size:1rem;font-weight:600;backdrop-filter:blur(4px);';
            document.body.appendChild(_tvConnBadge);
        }
        _tvConnBadge.style.display = 'block';
    } else if (_tvConnBadge) {
        _tvConnBadge.style.display = 'none';
    }
}

// ---- Hold-logoer på TV (kun holdkamp-delkampe) ----
function tvNormName(s) {
    return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Hvilket hold (1/2) i delkampen tilhører en spiller med dette navn?
function tvTeamForName(name, game) {
    const n = tvNormName(name);
    if (!n) return null;
    const t1 = [game.team1_player1, game.team1_player2].map(tvNormName).filter(Boolean);
    const t2 = [game.team2_player1, game.team2_player2].map(tvNormName).filter(Boolean);
    if (t1.includes(n)) return 1;
    if (t2.includes(n)) return 2;
    return null;
}

// Sæt logo idempotent — skift kun src/visning når værdien ændrer sig (undgå flicker).
function applyTvLogo(img, logo) {
    if (!img) return;
    const url = logo ? logo.url : '';
    if (img.dataset.logoUrl === url) return;
    img.dataset.logoUrl = url;
    if (url) {
        img.src = url;
        img.style.display = '';
    } else {
        img.removeAttribute('src');
        img.style.display = 'none';
    }
}

// Vis hold-logoer (holdkamp) ELLER spiller-logoer (individuelle/turnering) — aldrig begge.
async function updateTvTeamLogos(gameState, isMatchActive) {
    const imgT1 = document.getElementById('team1Logo');
    const imgT2 = document.getElementById('team2Logo');
    const pImgs = {
        1: document.getElementById('player1Logo'),
        12: document.getElementById('player1Logo2'),
        2: document.getElementById('player2Logo'),
        22: document.getElementById('player2Logo2')
    };
    const hideAll = () => {
        applyTvLogo(imgT1, null); applyTvLogo(imgT2, null);
        Object.values(pImgs).forEach(el => applyTvLogo(el, null));
    };

    if (!isMatchActive || !window.LogoMatch) { hideAll(); return; }

    try {
        if (_tvLogos === null) _tvLogos = (await api.getPublicLogos()) || [];
        const byCourt = await api.getTeamMatchByCourt(courtId);

        // Bestem viste venstre/højre spiller (samme swap-logik som updatePlayerNames)
        const playersSwapped = originalPlayer1Name && gameState.player1.name === originalPlayer2Name;
        const left = playersSwapped ? gameState.player2 : gameState.player1;
        const right = playersSwapped ? gameState.player1 : gameState.player2;

        if (byCourt && byCourt.game) {
            // HOLDKAMP → hold-logoer (del C), skjul spiller-logoer
            Object.values(pImgs).forEach(el => applyTvLogo(el, null));
            const game = byCourt.game;
            let leftTeam = tvTeamForName(left.name, game) || tvTeamForName(left.name2, game);
            let rightTeam = leftTeam === 1 ? 2 : (leftTeam === 2 ? 1 : null);
            if (!leftTeam) {
                rightTeam = tvTeamForName(right.name, game) || tvTeamForName(right.name2, game);
                leftTeam = rightTeam === 1 ? 2 : (rightTeam === 2 ? 1 : 1);
                if (!rightTeam) rightTeam = 2;
            }
            applyTvLogo(imgT1, LogoMatch.resolveTeamLogo(byCourt, leftTeam, _tvLogos));
            applyTvLogo(imgT2, LogoMatch.resolveTeamLogo(byCourt, rightTeam, _tvLogos));
            return;
        }

        // INDIVIDUEL/TURNERING → spiller-logoer, skjul hold-logoer
        applyTvLogo(imgT1, null); applyTvLogo(imgT2, null);
        if (_tvPlayerLogos === null) _tvPlayerLogos = (await api.getPlayerLogos()) || [];
        if (_tvClubByName === null) {
            const clubs = (await api.getPlayerClubs()) || [];
            _tvClubByName = {};
            clubs.forEach(c => { if (c && c.name) _tvClubByName[LogoMatch.normalizeName(c.name)] = c.club; });
        }
        const opts = { playerLogos: _tvPlayerLogos, clubByName: _tvClubByName, logos: _tvLogos };
        applyTvLogo(pImgs[1], LogoMatch.resolvePlayerLogo(left.name, opts));
        applyTvLogo(pImgs[12], LogoMatch.resolvePlayerLogo(left.name2, opts));
        applyTvLogo(pImgs[2], LogoMatch.resolvePlayerLogo(right.name, opts));
        applyTvLogo(pImgs[22], LogoMatch.resolvePlayerLogo(right.name2, opts));
    } catch (e) {
        hideAll();
    }
}

// Extract first name (before '/') for doubles display
function extractFirstName(fullName) {
    if (!fullName) return '';
    const parts = fullName.split('/');
    return parts[0].trim();
}

// Kompakt visning til TV-scoreboardet: drop efternavnet saa fonten kan vaere
// stoerre. 1 ord = som-er, 2 ord = foerste, 3+ ord = de to foerste.
// Det fulde navn vises stadig via periodisk marquee-scroll (se runMarqueeOnce).
//   "Jesper"                  -> "Jesper"
//   "Jesper Soerensen"        -> "Jesper"
//   "Hans Henrik Heidemann"   -> "Hans Henrik"
//   "Jens Peter Hansen-Olsen" -> "Jens Peter"
function compactDisplayName(fullName) {
    if (!fullName) return '';
    const parts = fullName.trim().split(/\s+/).filter(Boolean);
    if (parts.length <= 1) return parts.join(' ');
    const keep = Math.min(parts.length - 1, 2);
    return parts.slice(0, keep).join(' ');
}

// Update player names display
function updatePlayerNames(gameState, playersSwapped) {
    const isDoubles = gameState.isDoubles || false;

    // Determine display players based on swap status
    let displayPlayer1, displayPlayer2;
    if (playersSwapped) {
        displayPlayer1 = gameState.player2;
        displayPlayer2 = gameState.player1;
    } else {
        displayPlayer1 = gameState.player1;
        displayPlayer2 = gameState.player2;
    }

    // VIGTIGT: loadCourtData() poller hver 2s og kalder os hver gang. Hvis vi
    // bare skrev textContent og kaldte cancelAllMarquees ubetinget, ville en
    // igangvaerende 5-sek marquee blive draebt efter ca. 2 sek (= "navnet
    // blinker"). setName skriver kun til DOM hvis navnet faktisk har aendret
    // sig — saa pollingen er en no-op for et stabilt scoreboard.
    let anyChanged = false;
    const setName = (el, full) => {
        if (!el) return;
        const trimmed = (full || '').trim();
        // Vi sammenligner kun mod dataset.fullText (den raa kilde) — IKKE mod
        // el.textContent, fordi en aktiv marquee laegger en <span> med det
        // fulde navn ind, hvilket faar textContent til at returnere fuld-tekst
        // mens compactDisplayName giver short-tekst. Et match-fail ville saa
        // draebe marqueeen hvert 2. sek (= "navnet blinker").
        if (el.dataset.fullText === trimmed) return;

        // Aendret navn → annuller evt. marquee paa netop dette element
        if (el.classList.contains('is-marquee')) {
            el.classList.remove('is-marquee');
            delete el.dataset.marqueeShort;
        }
        el.textContent = compactDisplayName(full);
        if (trimmed) {
            el.dataset.fullText = trimmed;
        } else {
            delete el.dataset.fullText;
        }
        anyChanged = true;
    };

    const p1 = document.getElementById('player1Name');
    const p1m = document.getElementById('player1Name2');
    const p2 = document.getElementById('player2Name');
    const p2m = document.getElementById('player2Name2');

    // Player 1
    if (isDoubles && displayPlayer1.name2) {
        // extractFirstName haandterer slash-separerede alias-navne, og
        // compactDisplayName droppen efternavnet ovenpaa.
        setName(p1, extractFirstName(displayPlayer1.name));
        setName(p1m, extractFirstName(displayPlayer1.name2));
        if (p1m.style.display !== 'block') p1m.style.display = 'block';
    } else {
        setName(p1, displayPlayer1.name);
        if (p1m.style.display !== 'none') p1m.style.display = 'none';
    }

    // Player 2
    if (isDoubles && displayPlayer2.name2) {
        setName(p2, extractFirstName(displayPlayer2.name));
        setName(p2m, extractFirstName(displayPlayer2.name2));
        if (p2m.style.display !== 'block') p2m.style.display = 'block';
    } else {
        setName(p2, displayPlayer2.name);
        if (p2m.style.display !== 'none') p2m.style.display = 'none';
    }

    // Kun re-fit hvis noget faktisk aendrede sig — fit-loopet hver 2s ville
    // ellers nulstille --fit-scale midt i en marquee.
    if (anyChanged) {
        requestAnimationFrame(fitAllPlayerNames);
    }
}

// ===== Auto-fit player names =====
// Default-fonten i CSS er stor (god til korte navne); naar et navn er for
// langt til at faa plads i .team-names-kolonnen, saetter vi en CSS-variabel
// der ganger fonten ned saa hele navnet vises uden ellipsis.
const PLAYER_NAME_MIN_SCALE = 0.45; // under det her er teksten ulaeselig; tag ellipsis i stedet
function fitPlayerName(el) {
    if (!el || el.offsetParent === null) return;  // skjult (singles: partner-name)
    if (el.classList.contains('is-marquee')) return;  // marquee styrer selv stoerrelsen
    // Nulstil saa vi maaler unconstrained tekstbredde foer vi beslutter scale
    el.style.setProperty('--fit-scale', '1');
    const container = el.parentElement;  // .team-names
    if (!container) return;
    const containerW = container.clientWidth;
    if (containerW === 0) return;
    const textW = el.scrollWidth;
    if (textW <= containerW) return;
    // 0.98 marginal for at undgaa sub-pixel rounding der ellers stadig giver ellipsis
    const scale = Math.max((containerW / textW) * 0.98, PLAYER_NAME_MIN_SCALE);
    el.style.setProperty('--fit-scale', scale.toFixed(3));
}

function fitAllPlayerNames() {
    document.querySelectorAll('.player-name').forEach(fitPlayerName);
}

let playerNameResizeObserver = null;
function setupPlayerNameAutoFit() {
    if (playerNameResizeObserver || typeof ResizeObserver === 'undefined') return;
    let rafPending = false;
    playerNameResizeObserver = new ResizeObserver(() => {
        // Coalesce resize-stoejen (window-drag) til én maaling per frame
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(() => {
            rafPending = false;
            fitAllPlayerNames();
        });
    });
    document.querySelectorAll('.team-names').forEach(el => playerNameResizeObserver.observe(el));
}

// ===== Marquee: scroll det fulde navn igennem en gang imellem =====
// Compact-visningen viser kun fornavn(e); marqueen er den maade vi alligevel
// faar vist efternavnet paa, uden permanent at ofre font-stoerrelsen.
const MARQUEE_INTERVAL_MS = 10000;     // pause mellem at sidste scroll er faerdig og naeste starter
const MARQUEE_PX_PER_SECOND = 104;     // konstant scroll-fart — lange navne tager laengere

function runMarqueeOnce(el, fullText) {
    if (!el || !fullText) return;
    if (el.classList.contains('is-marquee')) return;
    const shortText = el.textContent;
    if (fullText === shortText) return;  // intet skjult — spring over

    // Wrap teksten i en inline-block span. Animationen scroller fra
    // translateX(0) (foerste bogstav lige hvor compact-versionens foerste
    // bogstav stod) til translateX(-span.scrollWidth) (hele teksten passeret
    // ud af venstre side). Distance + konstant fart = lange navne tager
    // laengere tid, saa alle marquees starter samtidig men slutter forskudt.
    el.dataset.marqueeShort = shortText;
    el.innerHTML = '';
    const span = document.createElement('span');
    span.className = 'marquee-text';
    span.textContent = fullText;
    el.appendChild(span);
    el.classList.add('is-marquee');
    // Vi rorer IKKE --fit-scale her — marqueeen skal rendere ved samme font-
    // stoerrelse som compact-versionen, ellers "hopper" teksten op/ned i
    // stoerrelse i overgangen. Span'et arver parent's font-size via calc().

    // scrollWidth maales efter span er i DOM (med den aktuelle fit-scale)
    const distance = span.scrollWidth;
    const durationS = Math.max(1.5, distance / MARQUEE_PX_PER_SECOND);
    span.style.setProperty('--marquee-dx', `-${distance}px`);
    span.style.animationDuration = `${durationS}s`;

    span.addEventListener('animationend', () => {
        // Hvis updatePlayerNames har koert imellemtiden, har den ryddet
        // is-marquee og dataset — saa lader vi den nye state staa.
        if (!el.classList.contains('is-marquee')) return;
        el.classList.remove('is-marquee');
        el.textContent = el.dataset.marqueeShort || shortText;
        delete el.dataset.marqueeShort;
        fitPlayerName(el);
    }, { once: true });
}

function cancelAllMarquees() {
    document.querySelectorAll('.player-name.is-marquee').forEach(el => {
        el.classList.remove('is-marquee');
        delete el.dataset.marqueeShort;
        // innerHTML/textContent overskrives af kalderen (updatePlayerNames)
    });
}

// Starter marquee paa alle synlige navne med skjult del og venter til hver
// enkelt animation er faerdig. Returnerer naar alt er done.
async function tickAndWaitForMarquees() {
    const candidates = [];
    document.querySelectorAll('.player-name').forEach(el => {
        if (el.offsetParent === null) return;       // skjult (singles makker)
        if (el.classList.contains('is-marquee')) return;
        const fullText = el.dataset.fullText;
        if (!fullText) return;
        if (fullText === el.textContent) return;    // intet skjult
        candidates.push(el);
    });
    if (!candidates.length) return;

    const waits = candidates.map(el => new Promise(resolve => {
        runMarqueeOnce(el, el.dataset.fullText);
        const span = el.querySelector('.marquee-text');
        if (!span) { resolve(); return; }
        // Safety-net hvis marqueeen bliver annulleret mid-flight (textContent
        // overskrevet af updatePlayerNames pga. navne-aendring) — vi skal
        // ikke faa loopet til at haenge i evig venten.
        const durationS = parseFloat(span.style.animationDuration) || 5;
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };
        span.addEventListener('animationend', finish, { once: true });
        setTimeout(finish, durationS * 1000 + 500);
    }));

    await Promise.all(waits);
}

let marqueeLoopStarted = false;
async function setupPlayerNameMarquee() {
    if (marqueeLoopStarted) return;
    marqueeLoopStarted = true;
    // Loop: pause -> scroll alt -> vent til faerdig -> pause -> ...
    // Det giver eksakt MARQUEE_INTERVAL_MS mellem at sidste scroll slutter
    // og naeste starter, i stedet for at intervallet talte fra start-tidspunkt.
    while (true) {
        await new Promise(r => setTimeout(r, MARQUEE_INTERVAL_MS));
        await tickAndWaitForMarquees();
    }
}

// Update set score boxes
function updateSetScores(gameState, playersSwapped) {
    const setHistory = gameState.setScoresHistory || [];
    const currentSetIndex = gameState.player1.games + gameState.player2.games;

    // Determine display players
    let displayPlayer1, displayPlayer2;
    if (playersSwapped) {
        displayPlayer1 = gameState.player2;
        displayPlayer2 = gameState.player1;
    } else {
        displayPlayer1 = gameState.player1;
        displayPlayer2 = gameState.player2;
    }

    // Update set boxes for both teams
    updateTeamSetBoxes('team1', displayPlayer1, setHistory, currentSetIndex, gameState, playersSwapped);
    updateTeamSetBoxes('team2', displayPlayer2, setHistory, currentSetIndex, gameState, playersSwapped);
}

function updateTeamSetBoxes(teamId, playerData, setHistory, currentSetIndex, gameState, playersSwapped) {
    // Determine which team we're displaying (1 or 2)
    const isTeam1 = teamId === 'team1';

    // Set 1
    const box1 = document.getElementById(`${teamId}Set1`);
    if (setHistory.length >= 1) {
        // Set 1 is complete - show final score from history (AUTHORITATIVE SOURCE)
        const set1Score = extractTeamScore(setHistory[0], isTeam1, gameState, playersSwapped);
        box1.textContent = set1Score;
        box1.className = 'set-box'; // Reset classes
        markSetResult(teamId, 1, setHistory[0], isTeam1, gameState, playersSwapped);
    } else if (currentSetIndex === 0) {
        // Set 1 is current ongoing set - show and cache current score
        const currentScore = playerData.score;
        // Cache maximum score we see (for fallback if history delayed)
        if (currentScore > cachedSetScores[teamId].set1) {
            cachedSetScores[teamId].set1 = currentScore;
        }
        box1.textContent = currentScore;
        box1.className = 'set-box current';
    } else {
        // Set 1 finished but history not updated yet - use cached score as fallback
        box1.textContent = cachedSetScores[teamId].set1 || '-';
        box1.className = 'set-box';
    }

    // Set 2
    const box2 = document.getElementById(`${teamId}Set2`);
    if (setHistory.length >= 2) {
        // Set 2 is complete - show final score from history (AUTHORITATIVE SOURCE)
        const set2Score = extractTeamScore(setHistory[1], isTeam1, gameState, playersSwapped);
        box2.textContent = set2Score;
        box2.className = 'set-box'; // Reset classes
        markSetResult(teamId, 2, setHistory[1], isTeam1, gameState, playersSwapped);
    } else if (currentSetIndex === 1) {
        // Set 2 is current ongoing set - show and cache current score
        const currentScore = playerData.score;
        if (currentScore > cachedSetScores[teamId].set2) {
            cachedSetScores[teamId].set2 = currentScore;
        }
        box2.textContent = currentScore;
        box2.className = 'set-box current';
    } else if (currentSetIndex >= 2) {
        // Set 2 finished but history not updated yet - use cached score as fallback
        box2.textContent = cachedSetScores[teamId].set2 || '-';
        box2.className = 'set-box';
    } else {
        // Not started yet
        box2.textContent = '-';
        box2.className = 'set-box';
    }

    // Set 3
    const box3 = document.getElementById(`${teamId}Set3`);
    if (setHistory.length >= 3) {
        // Set 3 is complete - show final score from history (AUTHORITATIVE SOURCE)
        const set3Score = extractTeamScore(setHistory[2], isTeam1, gameState, playersSwapped);
        box3.textContent = set3Score;
        box3.className = 'set-box'; // Reset classes
        markSetResult(teamId, 3, setHistory[2], isTeam1, gameState, playersSwapped);
    } else if (currentSetIndex === 2) {
        // Set 3 is current ongoing set - show and cache current score
        const currentScore = playerData.score;
        if (currentScore > cachedSetScores[teamId].set3) {
            cachedSetScores[teamId].set3 = currentScore;
        }
        box3.textContent = currentScore;
        box3.className = 'set-box current';
    } else {
        // Not started yet
        box3.textContent = '-';
        box3.className = 'set-box';
    }
}

function extractTeamScore(setData, isTeam1, gameState, playersSwapped) {
    let scoreText;

    if (typeof setData === 'string') {
        // Old format: "21-15"
        scoreText = setData;
    } else {
        // New format: object with player names and score
        const storedPlayer1Name = setData.player1Name;

        // Check if stored names match original positions
        if (storedPlayer1Name === originalPlayer1Name) {
            // Names are in original order
            scoreText = setData.score;
        } else {
            // Names were swapped when set was saved - swap score back
            const scores = setData.score.split('-').map(s => s.trim());
            scoreText = `${scores[1]}-${scores[0]}`;
        }
    }

    // Parse score and return appropriate team's score
    const scores = scoreText.split('-').map(s => parseInt(s.trim()));
    return isTeam1 ? scores[0] : scores[1];
}

function markSetResult(teamId, setNum, setData, isTeam1, gameState, playersSwapped) {
    const box = document.getElementById(`${teamId}Set${setNum}`);

    let scoreText;
    if (typeof setData === 'string') {
        scoreText = setData;
    } else {
        const storedPlayer1Name = setData.player1Name;
        if (storedPlayer1Name === originalPlayer1Name) {
            scoreText = setData.score;
        } else {
            const scores = setData.score.split('-').map(s => s.trim());
            scoreText = `${scores[1]}-${scores[0]}`;
        }
    }

    const scores = scoreText.split('-').map(s => parseInt(s.trim()));
    const team1Score = scores[0];
    const team2Score = scores[1];

    if (isTeam1) {
        if (team1Score > team2Score) {
            box.classList.add('won');
        } else {
            box.classList.add('lost');
        }
    } else {
        if (team2Score > team1Score) {
            box.classList.add('won');
        } else {
            box.classList.add('lost');
        }
    }
}

// Update serving team highlight
function updateServingHighlight(gameState, playersSwapped) {
    const team1Row = document.getElementById('team1Row');
    const team2Row = document.getElementById('team2Row');

    // Remove existing highlights
    team1Row.classList.remove('serving');
    team2Row.classList.remove('serving');

    // Determine serving team based on game type
    let servingTeam = null;

    if (gameState.isDoubles) {
        // For doubles: use servingTeam (which team is serving)
        servingTeam = gameState.servingTeam || gameState.serving_team;
    } else {
        // For singles: use servingPlayer (which player is serving, 1 or 2)
        // servingPlayer directly maps to team (player 1 = team 1, player 2 = team 2)
        servingTeam = gameState.servingPlayer || gameState.serving_player;
    }

    // Validate serving team
    if (!servingTeam || (servingTeam !== 1 && servingTeam !== 2)) {
        // No valid serving team - don't highlight anything
        console.log('[TV V3] No valid serving info. Doubles:', gameState.isDoubles, 'servingTeam:', gameState.servingTeam, 'servingPlayer:', gameState.servingPlayer);
        return;
    }

    // If players are swapped, swap the serving indicator for consistent TV display
    if (playersSwapped) {
        servingTeam = servingTeam === 1 ? 2 : 1;
    }

    console.log('[TV V3] Serving team:', servingTeam, 'Doubles:', gameState.isDoubles, 'Players swapped:', playersSwapped);

    // Add serving highlight to correct team
    if (servingTeam === 1) {
        team1Row.classList.add('serving');
    } else if (servingTeam === 2) {
        team2Row.classList.add('serving');
    }
}

// ========== SPONSOR AND BANNER FUNCTIONS (UNCHANGED FROM V2) ==========

async function refreshSponsorSettings() {
    try {
        const oldImages = cachedSponsorImages;
        const images = await api.getSponsorImages('slideshow');

        const imagesChanged = !oldImages ||
                             oldImages.length !== images.length ||
                             !oldImages.every((img, idx) => images[idx] && img.id === images[idx].id);

        cachedSponsorImages = images;

        const courtBanners = await api.getSponsorImages('court');
        const oldBanner = cachedCourtBanner;

        cachedCourtBanner = courtBanners.find(banner =>
            banner.assignedCourts && banner.assignedCourts.includes(courtId)
        ) || null;

        const bannerChanged = (!oldBanner && cachedCourtBanner) ||
                             (oldBanner && !cachedCourtBanner) ||
                             (oldBanner && cachedCourtBanner && oldBanner.id !== cachedCourtBanner.id);

        const settings = await api.getSponsorSettings();
        cachedSlideDuration = settings.slideDuration * 1000;

        if (imagesChanged && isShowingSlideshow) {
            console.log('Sponsor images changed, restarting slideshow');
            restartSlideshow();
        }

        if (bannerChanged && isMatchCurrentlyActive) {
            console.log('Court banner changed, updating footer');
            updateCourtBanner();
        }
    } catch (error) {
        console.error('Failed to refresh sponsor settings:', error);
    }
}

function updateCourtBanner() {
    const footer = document.querySelector('.tv-footer');
    if (!footer) return;

    const isMatchActive = !isShowingSlideshow;

    if (isMatchActive && cachedCourtBanner) {
        footer.classList.add('has-banner');
        footer.innerHTML = `
            <img src="/uploads/${cachedCourtBanner.filename}"
                 alt="Court Banner"
                 class="court-banner-image">
        `;
    } else {
        footer.classList.remove('has-banner');
        footer.innerHTML = `
            <div class="live-indicator">
                <span class="live-dot"></span>
                LIVE
            </div>
        `;
    }
}

function restartSlideshow() {
    if (slideshowInterval) {
        clearInterval(slideshowInterval);
        slideshowInterval = null;
    }
    isShowingSlideshow = false;
    currentSlideIndex = 0;
    showSponsorSlideshow();
}

function getSponsorImages() {
    return cachedSponsorImages;
}

function getSlideDuration() {
    return cachedSlideDuration;
}

function showSponsorSlideshow() {
    const images = getSponsorImages();

    if (images.length === 0) {
        if (!isShowingSlideshow) {
            hideScoreboard();
            showDefaultMessage();
            isShowingSlideshow = true;
            updateCourtBanner();
        }
        return;
    }

    if (!isShowingSlideshow) {
        hideScoreboard();
        createSlideshowContainer();
        isShowingSlideshow = true;
        currentSlideIndex = 0;

        displayCurrentSlide(images);
        updateCourtBanner();

        if (images.length > 1) {
            const duration = getSlideDuration();
            slideshowInterval = setInterval(function() {
                const imgs = getSponsorImages();
                if (imgs.length > 1) {
                    currentSlideIndex = (currentSlideIndex + 1) % imgs.length;
                    displayCurrentSlide(imgs);
                }
            }, duration);
        }
    }
}

function hideSponsorSlideshow() {
    if (isShowingSlideshow) {
        if (slideshowInterval) {
            clearInterval(slideshowInterval);
            slideshowInterval = null;
        }

        stopScreensaver();

        const slideshowContainer = document.querySelector('.sponsor-slideshow');
        if (slideshowContainer) {
            slideshowContainer.remove();
        }

        showScoreboard();
        isShowingSlideshow = false;
        updateCourtBanner();
    }
}

function hideScoreboard() {
    const scoreboard = document.querySelector('.scoreboard');
    const header = document.querySelector('.tv-header');
    const footer = document.querySelector('.tv-footer');

    if (scoreboard) scoreboard.style.display = 'none';
    if (header) header.style.display = 'none';
    if (footer) footer.style.display = 'none';
}

function showScoreboard() {
    const scoreboard = document.querySelector('.scoreboard');
    const header = document.querySelector('.tv-header');
    const footer = document.querySelector('.tv-footer');

    if (scoreboard) scoreboard.style.display = 'flex';
    if (header) header.style.display = 'flex';
    if (footer) footer.style.display = 'flex';
}

function createSlideshowContainer() {
    const existing = document.querySelector('.sponsor-slideshow');
    if (existing) existing.remove();

    const container = document.createElement('div');
    container.id = 'sponsorSlideshowContainer';
    container.className = 'sponsor-slideshow active';
    document.querySelector('.tv-container').appendChild(container);
}

function displayCurrentSlide(images) {
    const container = document.getElementById('sponsorSlideshowContainer');
    if (!container || images.length === 0) return;

    const image = images[currentSlideIndex];

    container.innerHTML = `
        <img src="/uploads/${image.filename}"
             alt="${escapeHtml(image.original_name)}"
             class="sponsor-slide-image">
    `;
}

function showDefaultMessage() {
    const container = document.createElement('div');
    container.id = 'sponsorSlideshowContainer';
    container.className = 'sponsor-slideshow active';
    container.innerHTML = `
        <div class="screensaver-text">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><g transform="translate(0 1.2)"><ellipse cx="12" cy="7.7" rx="1.5" ry="6.8" transform="rotate(-33 12 14.5)"/><ellipse cx="12" cy="7.7" rx="1.5" ry="6.8" transform="rotate(-14 12 14.5)"/><ellipse cx="12" cy="7.7" rx="1.5" ry="6.8"/><ellipse cx="12" cy="7.7" rx="1.5" ry="6.8" transform="rotate(14 12 14.5)"/><ellipse cx="12" cy="7.7" rx="1.5" ry="6.8" transform="rotate(33 12 14.5)"/><rect x="9.4" y="14.3" width="5.2" height="1.7" rx="0.85"/><path d="M9.7 16.6h4.6v0.5a2.3 2.3 0 0 1-4.6 0z"/></g></svg>
            <div class="screensaver-label">Ingen aktiv kamp</div>
            <div class="screensaver-court">BANE ${courtId}</div>
        </div>
    `;
    document.querySelector('.tv-container').appendChild(container);
    startScreensaver();
}

function startScreensaver() {
    stopScreensaver();

    let x = -1;
    let y = -1;
    let dx = 0;
    let dy = 0;
    let lastTime = null;

    function animate(timestamp) {
        const c = document.getElementById('sponsorSlideshowContainer');
        const t = c ? c.querySelector('.screensaver-text') : null;
        if (!c || !t) return;

        if (x < 0) {
            // Initialize once sizes are known
            const maxX = c.offsetWidth - t.offsetWidth;
            const maxY = c.offsetHeight - t.offsetHeight;
            x = Math.max(0, maxX / 2);
            y = Math.max(0, maxY / 2);
            const speed = 20; // px/s
            const angle = Math.random() * 2 * Math.PI;
            dx = Math.cos(angle) * speed;
            dy = Math.sin(angle) * speed;
            if (Math.abs(dx) < 6) dx = dx < 0 ? -6 : 6;
            if (Math.abs(dy) < 6) dy = dy < 0 ? -6 : 6;
        }

        if (!lastTime) lastTime = timestamp;
        const delta = Math.min((timestamp - lastTime) / 1000, 0.1);
        lastTime = timestamp;

        x += dx * delta;
        y += dy * delta;

        const maxX = Math.max(0, c.offsetWidth - t.offsetWidth);
        const maxY = Math.max(0, c.offsetHeight - t.offsetHeight);

        if (x <= 0) { x = 0; dx = Math.abs(dx); }
        if (x >= maxX) { x = maxX; dx = -Math.abs(dx); }
        if (y <= 0) { y = 0; dy = Math.abs(dy); }
        if (y >= maxY) { y = maxY; dy = -Math.abs(dy); }

        t.style.left = Math.round(x) + 'px';
        t.style.top = Math.round(y) + 'px';

        screensaverAnimFrame = requestAnimationFrame(animate);
    }

    screensaverAnimFrame = requestAnimationFrame(animate);
}

function stopScreensaver() {
    if (screensaverAnimFrame) {
        cancelAnimationFrame(screensaverAnimFrame);
        screensaverAnimFrame = null;
    }
}

function escapeHtml(text) {
    // Escaper også anførselstegn — sikkert i både tekst- og attribut-kontekster
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ========== REST BREAK FUNCTIONS (UNCHANGED FROM V2) ==========

// Samlet pauselængde — bruges til progress-ringen. Kendes fra secondsLeft ved
// pausens start; loader TV'et midt i en pause, gættes den ud fra titlen
// ("Pause 1 minut" / "Pause mellem sæt - 2 minutter").
let localRestBreakTotal = 0;

function guessRestBreakTotal(title, secondsLeft) {
    const m = /(\d+)\s*minut/i.exec(title || '');
    if (m) return parseInt(m[1], 10) * 60;
    return Math.max(secondsLeft || 0, 60);
}

function renderRestBreakCountdown() {
    const timerDisplay = document.getElementById('tvRestBreakTimer');
    const ring = document.getElementById('tvRestBreakRing');
    if (!timerDisplay) return;

    const s = Math.max(0, localRestBreakSecondsLeft);
    timerDisplay.textContent = s >= 60
        ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
        : String(s);
    timerDisplay.classList.toggle('is-final', s <= 10);

    if (ring) {
        const CIRCUMFERENCE = 2 * Math.PI * 90; // matcher r=90 i SVG'en
        const fraction = localRestBreakTotal > 0 ? Math.min(1, s / localRestBreakTotal) : 0;
        ring.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - fraction));
    }
}

function showRestBreak(secondsLeft, title, gameState, playersSwapped) {
    const overlay = document.getElementById('tvRestBreakOverlay');
    const titleElement = document.getElementById('tvRestBreakTitle');

    if (!overlay) return;

    titleElement.textContent = title || 'Pause';

    const isNewRestBreak = !isRestBreakActive;

    if (isNewRestBreak) {
        localRestBreakSecondsLeft = secondsLeft || 0;
        localRestBreakTotal = guessRestBreakTotal(title, secondsLeft);
        isRestBreakActive = true;

        if (restBreakInterval) {
            clearInterval(restBreakInterval);
            restBreakInterval = null;
        }

        if (localRestBreakSecondsLeft > 0) {
            restBreakInterval = setInterval(() => {
                localRestBreakSecondsLeft--;
                if (localRestBreakSecondsLeft < 0) {
                    localRestBreakSecondsLeft = 0;
                }
                renderRestBreakCountdown();
            }, 1000);
        }
    } else if (typeof secondsLeft === 'number' && Math.abs(secondsLeft - localRestBreakSecondsLeft) > 2) {
        // Drift-korrektion: serverens nedtælling er sandheden — hop kun hvis
        // den lokale tælling er kommet mere end 2 sek. ud af trit
        localRestBreakSecondsLeft = secondsLeft;
    }

    renderRestBreakCountdown();

    if (gameState) {
        let displayPlayer1, displayPlayer2;
        if (playersSwapped) {
            displayPlayer1 = gameState.player2;
            displayPlayer2 = gameState.player1;
        } else {
            displayPlayer1 = gameState.player1;
            displayPlayer2 = gameState.player2;
        }

        document.getElementById('tvRestBreakPlayer1').textContent = displayPlayer1.name;
        document.getElementById('tvRestBreakPlayer2').textContent = displayPlayer2.name;

        const partner1Element = document.getElementById('tvRestBreakPlayer1Partner');
        const partner2Element = document.getElementById('tvRestBreakPlayer2Partner');
        const isDoubles = gameState.isDoubles && displayPlayer1.name2 && displayPlayer2.name2;

        if (isDoubles) {
            partner1Element.textContent = displayPlayer1.name2;
            partner1Element.style.display = 'block';
            partner2Element.textContent = displayPlayer2.name2;
            partner2Element.style.display = 'block';
        } else {
            partner1Element.style.display = 'none';
            partner2Element.style.display = 'none';
        }

        document.getElementById('tvRestBreakScore1').textContent = displayPlayer1.score;
        document.getElementById('tvRestBreakScore2').textContent = displayPlayer2.score;
        document.getElementById('tvRestBreakGames1').textContent = displayPlayer1.games;
        document.getElementById('tvRestBreakGames2').textContent = displayPlayer2.games;
    }

    overlay.style.display = 'flex';
}

function hideRestBreak() {
    const overlay = document.getElementById('tvRestBreakOverlay');
    if (overlay) {
        overlay.style.display = 'none';
    }

    if (restBreakInterval) {
        clearInterval(restBreakInterval);
        restBreakInterval = null;
    }

    isRestBreakActive = false;
    localRestBreakSecondsLeft = 0;
    localRestBreakTotal = 0;

    const timerDisplay = document.getElementById('tvRestBreakTimer');
    if (timerDisplay) {
        timerDisplay.classList.remove('is-final');
    }
}

// ========== MATCH FINISHED FUNCTIONS (UNCHANGED FROM V2) ==========

function formatPlayerNames(playerName, playerName2, isDoubles) {
    // Only show partner name if it's a doubles match AND partner name exists
    if (isDoubles && playerName2 && typeof playerName2 === 'string' && playerName2.trim() !== '') {
        return `${playerName} / ${playerName2}`;
    }
    return playerName;
}

function showMatchFinished(gameState, playersSwapped) {
    const overlay = document.getElementById('tvMatchFinishedOverlay');
    if (!overlay) return;

    let displayPlayer1Name, displayPlayer1Name2, displayPlayer2Name, displayPlayer2Name2;
    if (playersSwapped) {
        displayPlayer1Name = gameState.player2.name;
        displayPlayer1Name2 = gameState.player2.name2;
        displayPlayer2Name = gameState.player1.name;
        displayPlayer2Name2 = gameState.player1.name2;
    } else {
        displayPlayer1Name = gameState.player1.name;
        displayPlayer1Name2 = gameState.player1.name2;
        displayPlayer2Name = gameState.player2.name;
        displayPlayer2Name2 = gameState.player2.name2;
    }

    const setScoresContainer = document.getElementById('tvSetScoresContainer');
    if (setScoresContainer && gameState.setScoresHistory && gameState.setScoresHistory.length > 0) {
        const setScoresHtml = gameState.setScoresHistory.map((setData, index) => {
            let player1Name, player2Name, scoreText;

            if (typeof setData === 'string') {
                player1Name = formatPlayerNames(originalPlayer1Name || displayPlayer1Name,
                                               originalPlayer1Name2 || displayPlayer1Name2,
                                               gameState.isDoubles);
                player2Name = formatPlayerNames(originalPlayer2Name || displayPlayer2Name,
                                               originalPlayer2Name2 || displayPlayer2Name2,
                                               gameState.isDoubles);
                scoreText = setData;
            } else {
                const storedPlayer1Name = setData.player1Name;
                const scores = setData.score.split('-').map(s => parseInt(s.trim()));

                if (storedPlayer1Name === originalPlayer1Name) {
                    player1Name = formatPlayerNames(originalPlayer1Name, originalPlayer1Name2, gameState.isDoubles);
                    player2Name = formatPlayerNames(originalPlayer2Name, originalPlayer2Name2, gameState.isDoubles);
                    scoreText = setData.score;
                } else {
                    player1Name = formatPlayerNames(originalPlayer1Name, originalPlayer1Name2, gameState.isDoubles);
                    player2Name = formatPlayerNames(originalPlayer2Name, originalPlayer2Name2, gameState.isDoubles);
                    scoreText = `${scores[1]}-${scores[0]}`;
                }
            }

            const scores = scoreText.split('-').map(s => parseInt(s.trim()));
            const player1Won = scores[0] > scores[1];
            const winnerName = player1Won ? player1Name : player2Name;
            const winnerColor = '#4CAF50';
            const loserColor = 'var(--color-accent)';

            // Spillernavne kommer fra brugerinput (tæller/QR-gæster) — skal
            // escapes før innerHTML, ellers kan et navn køre script på TV'et
            return `
                <div style="margin: 20px 0; font-size: 1.1em;">
                    <div style="margin-bottom: 8px; color: #aaa;">Sæt ${index + 1}</div>
                    <div style="font-size: 1.3em;">
                        <span style="color: ${player1Won ? winnerColor : loserColor}; font-weight: ${player1Won ? 'bold' : 'normal'};">
                            ${escapeHtml(player1Name)}
                        </span>
                        <span style="color: #fff; margin: 0 15px; font-weight: bold;">
                            ${escapeHtml(scoreText)}
                        </span>
                        <span style="color: ${!player1Won ? winnerColor : loserColor}; font-weight: ${!player1Won ? 'bold' : 'normal'};">
                            ${escapeHtml(player2Name)}
                        </span>
                    </div>
                    <div style="color: ${winnerColor}; font-size: 0.9em; margin-top: 5px; font-weight: bold;">
                        ✓ ${escapeHtml(winnerName)}
                    </div>
                </div>
            `;
        }).join('');
        setScoresContainer.innerHTML = setScoresHtml;
    } else {
        const player1DisplayName = formatPlayerNames(displayPlayer1Name, displayPlayer1Name2, gameState.isDoubles);
        const player2DisplayName = formatPlayerNames(displayPlayer2Name, displayPlayer2Name2, gameState.isDoubles);

        let displayPlayer1Games, displayPlayer2Games;
        if (playersSwapped) {
            displayPlayer1Games = gameState.player2.games;
            displayPlayer2Games = gameState.player1.games;
        } else {
            displayPlayer1Games = gameState.player1.games;
            displayPlayer2Games = gameState.player2.games;
        }

        const player1WonMatch = displayPlayer1Games > displayPlayer2Games;
        const winnerColor = '#4CAF50';
        const loserColor = 'var(--color-accent)';

        setScoresContainer.innerHTML = `
            <div style="margin: 30px 0; font-size: 1.3em;">
                <div style="margin-bottom: 15px; color: #aaa; font-size: 0.9em;">Resultat</div>
                <div style="font-size: 1.5em; display: flex; justify-content: center; align-items: center; gap: 30px;">
                    <span style="color: ${player1WonMatch ? winnerColor : loserColor}; font-weight: ${player1WonMatch ? 'bold' : 'normal'};">
                        ${escapeHtml(player1DisplayName)}
                    </span>
                    <span style="color: #fff; font-weight: bold; font-size: 1.2em;">
                        ${displayPlayer1Games} - ${displayPlayer2Games}
                    </span>
                    <span style="color: ${!player1WonMatch ? winnerColor : loserColor}; font-weight: ${!player1WonMatch ? 'bold' : 'normal'};">
                        ${escapeHtml(player2DisplayName)}
                    </span>
                </div>
            </div>
        `;
    }

    const player1WonMatch = gameState.player1.games > gameState.player2.games;
    let winner;
    if (playersSwapped) {
        winner = player1WonMatch
            ? formatPlayerNames(displayPlayer2Name, displayPlayer2Name2, gameState.isDoubles)
            : formatPlayerNames(displayPlayer1Name, displayPlayer1Name2, gameState.isDoubles);
    } else {
        winner = player1WonMatch
            ? formatPlayerNames(displayPlayer1Name, displayPlayer1Name2, gameState.isDoubles)
            : formatPlayerNames(displayPlayer2Name, displayPlayer2Name2, gameState.isDoubles);
    }
    document.getElementById('tvFinishedWinner').textContent = winner;

    overlay.style.display = 'flex';
}

// Vis resultatet fra et snapshot (gemt da banen blev ryddet).
// Genbruger showMatchFinished ved at konstruere et minimalt gameState-objekt
// og sætte original-positions så set-historikkens swap-logik virker korrekt.
function showFinishedSnapshot(snap) {
    hideSponsorSlideshow();

    // Snapshot lagrer den endelige position; den bruges også som "original"
    // så scores i setScoresHistory ikke fejlagtigt byttes om i visningen.
    originalPlayer1Name = snap.player1.name;
    originalPlayer1Name2 = snap.player1.name2 || null;
    originalPlayer2Name = snap.player2.name;
    originalPlayer2Name2 = snap.player2.name2 || null;

    const fakeGameState = {
        player1: {
            name: snap.player1.name,
            name2: snap.player1.name2,
            score: 0,
            games: snap.player1.games || 0
        },
        player2: {
            name: snap.player2.name,
            name2: snap.player2.name2,
            score: 0,
            games: snap.player2.games || 0
        },
        setScoresHistory: snap.setScoresHistory || [],
        isDoubles: !!snap.isDoubles
    };

    showMatchFinished(fakeGameState, false);
}

function hideMatchFinished() {
    const overlay = document.getElementById('tvMatchFinishedOverlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
}

// ========== QR COUNTER ==========

// QR-tilstande:
//  idle     — fuld QR når banen er ledig (opretter en token så en kamp kan startes)
//  resume   — kompakt QR under aktivt spil (gæst der lukkede browseren kan scanne igen)
//  finished — fuld QR når en kamp lige er afgjort men ikke ryddet endnu; et scan
//             starter en frisk kamp, så man ikke behøver "Ryd bane" først
// peek=true (resume/finished): backend henter KUN en QR hvis banen har en aktiv
// guest-session (kampen kører i QR-selvbetjening). Ellers 404 → QR skjules, så
// holdkamp/turneringskampe aldrig viser en overtag-/ny-kamp-QR.
const QR_MODES = {
    idle:     { peek: false, compact: false, label: 'TÆL MED DIN TELEFON', hint: 'Scan med telefon' },
    resume:   { peek: true,  compact: true,  label: 'STYR KAMPEN',         hint: 'Scan for at genoptage' },
    finished: { peek: true,  compact: false, label: 'SCAN FOR NY KAMP',    hint: 'Scan for at starte en ny kamp' }
};

function showQrCounter(mode = 'idle') {
    if (!qrCounterEnabled) return;
    const cfg = QR_MODES[mode] || QR_MODES.idle;
    const container = document.getElementById('qrCounter');
    const img = document.getElementById('qrCounterImage');
    if (!container || !img) return;

    if (qrCounterMode === mode) return; // allerede vist i denne tilstand
    qrCounterMode = mode;

    const label = container.querySelector('.qr-counter__label');
    const hint = container.querySelector('.qr-counter__hint');
    container.classList.toggle('qr-counter--compact', cfg.compact);
    if (label) label.textContent = cfg.label;
    if (hint) hint.textContent = cfg.hint;

    // Cache-busting via timestamp så en ny token hentes efter invalidering.
    const q = cfg.peek ? 'resume=1&' : '';
    if (cfg.peek) {
        // Vent med at vise boksen til billedet faktisk loader — så en bane uden
        // guest-session (fx holdkamp) ikke blinker en tom QR-ramme før 404'en.
        container.style.display = 'none';
        qrCounterVisible = false;
        img.onload = () => { if (qrCounterMode === mode) { container.style.display = 'flex'; qrCounterVisible = true; } };
        img.onerror = () => { if (qrCounterMode === mode) hideQrCounter(); };
    } else {
        img.onload = null;
        img.onerror = null;
        container.style.display = 'flex';
        qrCounterVisible = true;
    }
    img.src = `/api/qr-code/${courtId}?${q}t=${Date.now()}`;
}

function hideQrCounter() {
    const container = document.getElementById('qrCounter');
    if (!container) return;
    if (qrCounterVisible) {
        container.style.display = 'none';
        qrCounterVisible = false;
    }
    qrCounterMode = null;
}

// Cleanup on page unload
window.addEventListener('beforeunload', function() {
    if (refreshInterval) clearInterval(refreshInterval);
    if (slideshowInterval) clearInterval(slideshowInterval);
    stopScreensaver();
});

