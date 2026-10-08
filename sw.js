// Open Battle's service worker (#34), built by the `serviceWorker` plugin in
// vite.config.ts, which fills in the build's files and version.
//
// - It keeps the app on the device, so hotseat, solo games, lessons, replays,
//   the shelves and the campaign book work without a network, and the app can
//   be installed. A new version waits until the player chooses to reload
//   (src/sw/register.ts says when: never mid-game).
// - It shows play-by-mail notifications (src/mail/mailbox.ts). A push from
//   the mailbox carries nothing about the game: it only says a file has come,
//   and the app fetches it from the mailbox when it opens.
const VERSION = "d05d1a5c6d61";
const FILES = ["assets/Board-DTp6J1hA.js","assets/CommandPanel-1WoMnKT2.js","assets/FigureLibrary-DXhe9e3k.js","assets/GameScreen-C9Q6RSI6.js","assets/MailLobby-CBVSJrTQ.js","assets/Miniatures-CnNzSlrK.js","assets/_virtual_sandbox-worker-BsWjWfml.js","assets/browser-bopAeLbn.js","assets/codec-DswBLtqW.js","assets/de-Dxt_Uu4X.js","assets/dist-D0EAIOa9.js","assets/fr-JTFzCQOH.js","assets/fxp-CNHNYw_7.js","assets/gameLog-DN_TrJ7z.js","assets/idb-DtkSURXi.js","assets/index-BltHjLE1.css","assets/index-r-LokC1Z.js","assets/jsx-runtime-NZYk81nU.js","assets/levels-DlkUqTaf.js","assets/library-B5GS0v36.js","assets/library-CRtRiLIV.js","assets/local-Dh7Odiot.js","assets/replayFile-DGeW80Zh.js","assets/rolldown-runtime-hePW80VL.js","assets/scheduler-C784v2VA.js","assets/showcase-Cq6H61et.js","assets/store-Coe3VM1P.js","assets/store-DBU-TS_k.js","assets/store-Zt9kfnLX.js","assets/talk-BFNTR9cb.js","assets/trystero-BEXaf1Dx.js","assets/worker-DG9I0sOt.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
const CACHE = `open-battle-${VERSION}`;
const DEV = VERSION === "dev";
const at = (path) => new URL(path, self.registration.scope).href;

self.addEventListener("install", (event) => {
  if (DEV) return;
  event.waitUntil(
    caches
      .open(CACHE)
      // Hashed build files never change, so the copies the page just loaded will do; the rest
      // (index.html, the manifest, icons) are fetched fresh.
      .then((cache) =>
        cache.addAll(
          FILES.map((f) => new Request(at(f), { cache: /-[\w-]{8}\.\w+$/.test(f) ? "default" : "reload" })),
        ),
      ),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names.filter((n) => n.startsWith("open-battle-") && n !== CACHE).map((n) => caches.delete(n)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// The page asks for the waiting version once the player says reload.
self.addEventListener("message", (event) => {
  if (event.data?.t === "skip-waiting") self.skipWaiting();
});

/** Things that only make sense live: the server's config, signalling, the mailbox, health. */
const LIVE = /\/(config\.json|health\.json|health|relay|mailbox)(\/|$|\?)/;

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (DEV || request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || LIVE.test(url.pathname)) return;
  if (request.mode === "navigate") {
    // The page: the network when it answers (it may carry a newer version), else the copy kept here.
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(at("index.html"), { cacheName: CACHE }).then((r) => r ?? Response.error()),
      ),
    );
    return;
  }
  // The build's files never change under a name: the kept copy first.
  event.respondWith(
    caches.match(request, { cacheName: CACHE, ignoreSearch: true }).then((kept) => kept ?? fetch(request)),
  );
});

self.addEventListener("push", (event) => {
  event.waitUntil(
    self.registration.showNotification("Your move · Open Battle", {
      body: "Your opponent sent their turn.",
      tag: "open-battle-mail",
      renotify: true,
      icon: at("icons/icon-192.png"),
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => w.url.startsWith(self.registration.scope));
      return open ? open.focus() : self.clients.openWindow(self.registration.scope);
    }),
  );
});
