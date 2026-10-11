// Reference-page bootstrap: mimics what the stub + CDN loader do, against the local server.
const q = new URLSearchParams(location.search);
window.__slips = { api: location.origin, key: q.get('key') ?? 'content', timeoutMs: 500 };
import('/dist/loader.js').then((m) => m.boot(window.__slips));
