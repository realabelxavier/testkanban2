/* Service Worker - Tarefas Kanban
   Mantém o comportamento original (cache/fetch) e adiciona lembretes. */

const REMINDER_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 horas
const REMINDER_TAG = 'tarefas-reminder';

self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));
self.addEventListener('fetch', (e) => {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});

/* ---------- IndexedDB (partilhada com a página) ---------- */
function idbOpen() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('tarefas-reminders', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('kv');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
async function idbGet(key) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
        const q = db.transaction('kv', 'readonly').objectStore('kv').get(key);
        q.onsuccess = () => { db.close(); resolve(q.result); };
        q.onerror = () => { db.close(); reject(q.error); };
    });
}
async function idbSet(key, value) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(value, key);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
    });
}

/* ---------- Lembretes em segundo plano (melhor esforço) ---------- */
async function checkAndNotify() {
    try {
        const state = await idbGet('state');
        if (!state || !state.enabled || !state.openCount) return;
        if (self.Notification && Notification.permission !== 'granted') return;

        const now = Date.now();
        const last = Number(await idbGet('last')) || 0;
        // Pequena tolerância (2 min) porque o Android agenda estes eventos de forma imprecisa
        if (last && last <= now && (now - last) < (REMINDER_INTERVAL_MS - 120000)) return;

        const titles = Array.isArray(state.titles) ? state.titles : [];
        let body = titles.map(t => '• ' + t).join('\n');
        if (state.openCount > titles.length) body += '\n… e mais ' + (state.openCount - titles.length);

        const n = state.openCount;
        const title = '🐾 ' + (n === 1 ? 'Tens 1 tarefa em aberto' : 'Tens ' + n + ' tarefas em aberto');

        await self.registration.showNotification(title, {
            body,
            tag: REMINDER_TAG,
            renotify: true,
            vibrate: [200, 100, 200],
            data: { url: self.registration.scope }
        });
        await idbSet('last', now);
    } catch (err) {
        // silencioso
    }
}

self.addEventListener('periodicsync', (event) => {
    if (event.tag === REMINDER_TAG) {
        event.waitUntil(checkAndNotify());
    }
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const targetUrl = (event.notification.data && event.notification.data.url) || self.registration.scope;
    event.waitUntil((async () => {
        const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const c of all) {
            if ('focus' in c) return c.focus();
        }
        if (clients.openWindow) return clients.openWindow(targetUrl);
    })());
});
