// Klub-admins mailadresse: kan bruges som brugernavn ved login (routes/clubAdmin.js)
// og sættes af super-admin (routes/superAdmin.js).

const MAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Normaliserer en mailadresse til gemning: trimmet og med små bogstaver.
 * Tom/udeladt → null (ingen mail). Returnerer { value } eller { error }.
 */
function normaliserMail(raw) {
    if (raw === undefined || raw === null) return { value: null };
    const mail = String(raw).trim().toLowerCase();
    if (!mail) return { value: null };
    if (mail.length > 200 || !MAIL_RE.test(mail)) {
        return { error: 'Ugyldig mailadresse' };
    }
    return { value: mail };
}

// Ligner indtastningen i login-feltet en mailadresse? (ellers er det kun et brugernavn)
function lignerMail(s) {
    return typeof s === 'string' && s.includes('@');
}

module.exports = { normaliserMail, lignerMail };
