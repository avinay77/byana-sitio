// Service worker de la app de administración (byana.mx/admin.html): recibe los avisos de pedidos nuevos.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "By Ana", {
    body: d.body || "Tienes un aviso nuevo.",
    icon: "/img/admin-192.png",
    badge: "/img/admin-192.png",
    tag: d.url || "byana",
    data: { url: d.url || "/admin" },
  }));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/admin", self.location.origin).href;
  e.waitUntil((async () => {
    const ws = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of ws) if (w.url.includes("/admin")) { await w.focus(); return w.navigate(url); }
    return self.clients.openWindow(url);
  })());
});
