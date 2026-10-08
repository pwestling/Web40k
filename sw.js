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
const VERSION = "c46f8b435b8a";
const FILES = ["assets/Board-CRH1VQta.js","assets/CommandPanel-ChNDUfXJ.js","assets/Editor-SAu-D91y.js","assets/FigureLibrary-BB2m3wcm.js","assets/GameScreen-CbkFLYpO.js","assets/MailLobby-DXkVL-hr.js","assets/Miniatures-BRsvlIwj.js","assets/Workshop-Yf9HBAUf.js","assets/_virtual_sandbox-worker-C3JJKiLN.js","assets/_virtual_soak-worker-BPtgkjlq.js","assets/base64-gMTPUZJI.js","assets/browser-bopAeLbn.js","assets/codec-D2EJBc5v.js","assets/de-CSKT0c5A.js","assets/dist-D0EAIOa9.js","assets/fr-CBWtBiYa.js","assets/fxp-CNHNYw_7.js","assets/gameLog-B3PvxJbw.js","assets/idb-Bd5JKEKS.js","assets/index-COoJveac.css","assets/index-DrSVj41-.js","assets/jsx-runtime-BtH0gOTJ.js","assets/lesson-1WsDOSjD.js","assets/levels-DlkUqTaf.js","assets/library-3oO5XFAK.js","assets/library-Bjh7Sy8f.js","assets/local-BVRbUG6n.js","assets/react-DB-4Zxce.js","assets/react-dom-6cEjSHVw.js","assets/replayFile-DA-PMeqw.js","assets/runtime-BygHySvj.js","assets/scheduler-pDGbHDo7.js","assets/store-BJ4hho5r.js","assets/store-DOxYDBaS.js","assets/store-u55oqmVt.js","assets/talk-D_S9W8fS.js","assets/trystero-0Rwqk1rG.js","assets/version-Cu_hM-Xx.js","assets/worker-DG9I0sOt.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
