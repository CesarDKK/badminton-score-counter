// Små DOM-/tekst-hjælpere til brugerfladen.

export function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const UGEDAGE = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'];
const MAANEDER = ['januar', 'februar', 'marts', 'april', 'maj', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'december'];

/** "2025-11-22" → "lørdag 22. november 2025" */
export function datoTekst(iso, { kort = false } = {}) {
    const [aar, md, dag] = iso.split('-').map(Number);
    const d = new Date(Date.UTC(aar, md - 1, dag));
    const ugedag = UGEDAGE[d.getUTCDay()];
    if (kort) return `${ugedag.slice(0, 3)}. ${dag}/${md}`;
    return `${ugedag} ${dag}. ${MAANEDER[md - 1]} ${aar}`;
}

export function procent(x) {
    if (!Number.isFinite(x)) return '–';
    return `${Math.round(x * 100)} %`;
}

export function tal(x, decimaler = 0) {
    return Number(x).toLocaleString('da-DK', { minimumFractionDigits: decimaler, maximumFractionDigits: decimaler });
}
