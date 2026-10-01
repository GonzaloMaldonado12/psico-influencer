// Service worker: la app funciona sin conexión. Caché primero (arranque instantáneo)
// y actualización en segundo plano cuando hay conexión.
const VERSION = 'psico-v21';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/store.js',
  'js/lib/util.js',
  'js/lib/db.js',
  'js/lib/dom.js',
  'js/core/timeline.js',
  'js/core/captions.js',
  'js/core/audio-analysis.js',
  'js/core/follow.js',
  'js/core/script-tools.js',
  'js/core/media.js',
  'js/core/render.js',
  'js/core/player.js',
  'js/core/exporter.js',
  'js/core/transcribe.js',
  'js/core/transcribe-worker.js',
  'js/views/projects.js',
  'js/views/scripts.js',
  'js/views/script-editor.js',
  'js/views/recorder.js',
  'js/views/editor.js',
  'js/views/export.js',
  'js/views/script-dialogs.js',
  'js/views/share.js',
  'js/views/editor-pro.js',
  'js/views/ai-dialogs.js',
  'js/views/ai-studio.js',
  'js/views/lighting.js',
  'js/core/platforms.js',
  'js/core/loudness.js',
  'js/core/camera-pro.js',
  'js/core/scenes.js',
  'js/core/sfx.js',
  'js/core/sfx-more.js',
  'js/core/fx-lib.js',
  'js/core/fonts.js',
  'js/core/timeline-pro.js',
  'js/views/editor-studio.js',
  'js/core/lighting.js',
  'js/core/emoji.js',
  'js/core/grade.js',
  'js/core/effects.js',
  'js/core/pro-export.js',
  'js/core/music-gen.js',
  'js/ai/vision.js',
  'js/ai/face-track.js',
  'js/ai/llm.js',
  'js/ai/llm-worker.js',
  'vendor/mediabunny.min.mjs',
  'vendor/mediapipe/vision_bundle.mjs',
  'vendor/mediapipe/wasm/vision_wasm_internal.js',
  'vendor/mediapipe/wasm/vision_wasm_internal.wasm',
  'vendor/models/selfie_segmenter.tflite',
  'vendor/models/selfie_multiclass_256x256.tflite',
  'vendor/models/face_landmarker.task',
  'js/views/brand.js',
  'js/views/ideas.js',
  'js/views/screen.js',
  'js/views/settings.js',
  'js/views/more.js',
  'js/views/takes.js',
  'js/views/take-actions.js',
  'js/views/iphone.js',
  'js/core/voice-pace.js',
  'js/core/take-store.js',
  'js/core/take-export.js',
  'js/core/music-tools.js',
  'js/ai/ai-usage.js',
  'js/ai/claude.js',
  'js/ai/stock.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(VERSION)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' })))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && !k.startsWith('transformers')).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function timeout(ms) {
  return new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  const sameOrigin = url.origin === self.location.origin;
  if (sameOrigin) {
    // Caché primero (arranque instantáneo aunque el PC esté apagado) y actualización en segundo plano.
    e.respondWith(
      (async () => {
        const cache = await caches.open(VERSION);
        const cached = (await cache.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? await cache.match('index.html') : null);
        const network = Promise.race([fetch(req), timeout(8000)])
          .then((res) => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => null);
        if (cached) {
          e.waitUntil(network);
          return cached;
        }
        return (await network) || new Response('Sin conexión', { status: 503 });
      })()
    );
    return;
  }
  // Librería externa (solo la transcripción con IA): caché primero. Los modelos
  // los guarda Transformers.js en su propia caché.
  if (url.host === 'cdn.jsdelivr.net') {
    e.respondWith(
      (async () => {
        const cache = await caches.open('transformers-cdn');
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok && res.type !== 'opaque') cache.put(req, res.clone());
        return res;
      })()
    );
  }
});
