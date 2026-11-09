// Tager ét skærmbillede via Chrome DevTools: node driver.mjs <chrome-ip> <shot-navn>
import fs from 'node:fs';
const [ip, navn] = process.argv.slice(2);
const mod = await import('./shots.mjs'); const shots = { ...mod.default, ...(mod.ekstra || {}) };
const shot = shots[navn];
const sleep = ms => new Promise(r => setTimeout(r, ms));

const tgt = await (await fetch(`http://${ip}:9222/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const vent = new Map(); const events = [];
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && vent.has(d.id)) { vent.get(d.id)(d); vent.delete(d.id); } else events.push(d); };
const cdp = (method, params = {}) => new Promise(r => { const i = ++id; vent.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: shot.w, height: shot.h, deviceScaleFactor: shot.dpr || 1, mobile: false });
const qr = fs.readFileSync(new URL('./qr.b64', import.meta.url), 'utf8').trim();
// Før sidens egne scripts: tema i cachen, QR-endpoint og tema-API stubbet
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
  try { localStorage.setItem('cachedTheme', JSON.stringify(${JSON.stringify(STANDARD())})); } catch {}
  window.__QR = 'data:image/png;base64,${qr}';
  const STUB = ${JSON.stringify(shot.stub || [])};
  const of = window.fetch.bind(window);
  window.fetch = (u, o) => {
    const s = String(u);
    if (s.includes('/api/qr-code/')) return of(window.__QR).then(r => r.blob()).then(b => new Response(b, { status: 200, headers: { 'Content-Type': 'image/png' } }));
    if (s.includes('/api/settings/theme')) return Promise.resolve(new Response(JSON.stringify(${JSON.stringify(STANDARD())}), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    if (s.includes('/api/mode')) return Promise.resolve(new Response(JSON.stringify({ qrCounter: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    for (const [p, d] of STUB) if (s.includes(p)) return Promise.resolve(new Response(JSON.stringify(typeof d === 'string' && d.startsWith('NU:') ? eval(d.slice(3)) : d), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    return of(u, o);
  };
` });
await cdp('Page.navigate', { url: shot.url });
await sleep(3500);
const r = await cdp('Runtime.evaluate', { expression: `(async () => { ${shot.setup} })()`, awaitPromise: true, returnByValue: true });
if (r.result?.exceptionDetails) console.error('setup-fejl', JSON.stringify(r.result.exceptionDetails).slice(0, 600));
await sleep(shot.wait || 2500);
if (shot.efter) await cdp('Runtime.evaluate', { expression: `(async () => { ${shot.efter} })()`, awaitPromise: true });
// Frys alle timere, så nedtællinger står stille på billedet
await cdp('Runtime.evaluate', { expression: 'for (let i = 1; i < 100000; i++) { clearInterval(i); clearTimeout(i); cancelAnimationFrame(i); } 1' });
await sleep(300);
let s;
if (shot.fuld) { const lm = await cdp('Page.getLayoutMetrics'); const hh = Math.ceil(lm.result.cssContentSize.height); s = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: shot.w, height: hh, scale: shot.skala || 1 } }); }
else s = await cdp('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(new URL(`./${navn}.png`, import.meta.url), Buffer.from(s.result.data, 'base64'));
const t = await cdp('Runtime.evaluate', { expression: 'document.body.innerText.slice(0,300)', returnByValue: true });
console.log(navn, 'OK |', (t.result?.result?.value || '').replace(/\n/g, ' · '));
ws.close();
process.exit(0);

function STANDARD() { return { theme_name: 'default', color_primary: '#4a5c6a', color_accent: '#e94560', color_bg_dark: '#11212d', color_bg_container: '#253745', color_bg_card: '#06141b' }; }
