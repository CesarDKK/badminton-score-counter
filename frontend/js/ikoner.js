// Fælles stregikoner (samme stil som tællerens tandhjul og "Skift side").
// Erstatter emoji i admin, super-admin, sponsorer og banevalg: emoji ser
// forskellige ud på Windows, Android og TV-boksene og kan ikke farves med
// temaet — stregikonerne følger tekstfarven (currentColor).
//
// Brug: Ikon('kalender') → '<svg …>' (som tekst til template strings).
(function () {
    const STIER = {
        person:    'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1',
        personer:  'M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1M16 3.1a4 4 0 0 1 0 7.8M22 21v-1a6 6 0 0 0-4-5.6',
        ur:        'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
        kalender:  'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM16 2v4M8 2v4M3 10h18',
        pokal:     'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3',
        slet:      'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6',
        tv:        'M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM8 21h8M12 17v4',
        tandhjul:  'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1',
        laas:      'M6 11h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2zM8 11V7a4 4 0 0 1 8 0v4',
        globus:    'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20',
        database:  'M4 5c0 1.7 3.6 3 8 3s8-1.3 8-3-3.6-3-8-3-8 1.3-8 3zM4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
        telefon:   'M9 2h6a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2',
        statistik: 'M3 3v18h18M8 16v-5M13 16V8M18 16V6',
        advarsel:  'M12 3 2 21h20zM12 10v5M12 18h.01',
        sted:      'M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
        oeje:      'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
        maerke:    'M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9zM7.5 8.5h.01',
        bold:      'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 7l4 3-1.5 4.5h-5L8 10zM12 7V2M16 10l5-1.5M14.5 14.5l3 4M9.5 14.5l-3 4M8 10 3 8.5'
    };

    // størrelse i em, så ikonet følger den omgivende tekst
    function Ikon(navn, stoerrelse) {
        const d = STIER[navn];
        if (!d) return '';
        const s = stoerrelse || '1em';
        return `<svg class="ikon" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
    }

    window.Ikon = Ikon;
})();
