// Baggrundstråd til "Lav kampprogram" og beslutningskortene (Fable-gennemgangen 2026-10-10, M9). På en stor
// turnering kan det være tusind gennemløb af planlæggeren; i hovedtråden ville siden fryse imens. Modulerne
// bruger ikke DOM, så de kan køre her uændret. Svar: { id, r, beslutninger } eller { id, fejl }.
import { lavKampprogram, lavBeslutninger } from './kampprogram.js';

self.onmessage = (e) => {
    const { id, projekt, valg } = e.data;
    try {
        const r = lavKampprogram(projekt, valg);
        self.postMessage({ id, r, beslutninger: lavBeslutninger(r.projekt, r.forslag) });
    } catch (err) {
        self.postMessage({ id, fejl: String(err?.message || err) });
    }
};
