// Service worker mínimo, a propósito sin guardar nada en caché.
// Su único trabajo es cumplir el requisito técnico para que el navegador
// ofrezca "Instalar app". No guarda copias viejas de tus archivos, así que
// cada vez que actualices app.js o firebase-config.js, el celular va a
// traer la versión nueva sin problema (no hace falta "limpiar caché").

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
