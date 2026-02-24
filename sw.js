// Service Worker Cache (업데이트 반영을 위해 버전 관리)
const CACHE_NAME = 'school-manager-v9';
const ASSETS = [
    '/',
    '/index.html',
    '/app.js',
    '/db.js',
    '/manifest.json',
    '/icon.png',
    'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
    'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js',
    'https://cdn.jsdelivr.net/npm/fullcalendar@6.1.8/index.global.min.js'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
    );
});

// 구버전 캐시 정리
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
        ))
    );
    self.clients.claim();
});

self.addEventListener('fetch', event => {
    // SPA/PWA 형태에서 새로고침 시 index.html 우선
    if (event.request.mode === 'navigate') {
        event.respondWith(
            caches.match('/index.html').then(res => res || fetch(event.request))
        );
        return;
    }

    event.respondWith(
        caches.match(event.request).then(response => response || fetch(event.request))
    );
});