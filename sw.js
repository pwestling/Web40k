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
const VERSION = "a8d6c0f67f15";
const FILES = ["assets/Board-UvgH-9Zv.js","assets/CommandPanel-BIf63pWk.js","assets/Editor-SAu-D91y.js","assets/FigureLibrary-CJTWmJh3.js","assets/GameScreen-Dkm3eTJ6.js","assets/MailLobby-DWYky8ze.js","assets/Miniatures-Cws09qGG.js","assets/Workshop-DGPwDKbd.js","assets/_virtual_sandbox-worker-Dtotc8NX.js","assets/_virtual_soak-worker-BJzfMF7i.js","assets/base64-gMTPUZJI.js","assets/browser-bopAeLbn.js","assets/codec-D2EJBc5v.js","assets/de-DU7RTvfN.js","assets/dist-D0EAIOa9.js","assets/fr-CPU1fDPB.js","assets/fxp-CNHNYw_7.js","assets/gameLog-w54jCBOa.js","assets/idb-BKGXQRhY.js","assets/index-COoJveac.css","assets/index-DlVzZE9F.js","assets/jsx-runtime-BtH0gOTJ.js","assets/lesson-Qvj6d4mj.js","assets/levels-DlkUqTaf.js","assets/library-A9VScAuv.js","assets/library-BdKFP_cz.js","assets/local-qKvSogqg.js","assets/react-DB-4Zxce.js","assets/react-dom-6cEjSHVw.js","assets/replayFile-Bx6IJhnP.js","assets/runtime-D-Uvt5qc.js","assets/scheduler-pDGbHDo7.js","assets/store-0c4ExGdF.js","assets/store-BMRMsvRC.js","assets/store-C9d4OLz4.js","assets/talk-CzdTUZ-6.js","assets/trystero-BD3siuQP.js","assets/version-CKhFwQiM.js","assets/worker-DG9I0sOt.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
