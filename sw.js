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
const VERSION = "9130e0b42ba3";
const FILES = ["assets/Board-ClKFH0-4.js","assets/CommandPanel-BnUQHFIB.js","assets/Editor-BRxrdMJd.js","assets/FigureLibrary-9lIgJivN.js","assets/GameScreen-8AfjgXu-.js","assets/MailLobby-ByBqHCyo.js","assets/Miniatures-CJlPKZ9I.js","assets/Workshop-Du0QMkH3.js","assets/_virtual_sandbox-worker-CVwu7UeL.js","assets/_virtual_soak-worker-DLB__mY1.js","assets/base64-gMTPUZJI.js","assets/browser-bopAeLbn.js","assets/codec-D2EJBc5v.js","assets/de-DxjAKXxZ.js","assets/dist-D0EAIOa9.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/fr-Bqo5GMaS.js","assets/fxp-CNHNYw_7.js","assets/gameLog-B6gBm1nO.js","assets/idb-CH0S8fXI.js","assets/index-BplXzGZ3.css","assets/index-BqIhgJuR.js","assets/jsx-runtime-BtH0gOTJ.js","assets/lesson-C2urqZGL.js","assets/levels-DlkUqTaf.js","assets/library-B6f9v9mw.js","assets/library-zFrwGSpx.js","assets/local-DqqlykfH.js","assets/react-DB-4Zxce.js","assets/replayFile-CQzpY-a3.js","assets/rift-lanterns-CYtgz3-J.js","assets/runtime-C0ZA4TyQ.js","assets/scheduler-pDGbHDo7.js","assets/showcase-DAZdFjrK.js","assets/store-CTFvL8m7.js","assets/store-Cfg0jXgZ.js","assets/store-DiWqC9zr.js","assets/syntax-CEL_Wvla.js","assets/talk-BNHF9zY3.js","assets/trystero-BFVLtD_J.js","assets/version-DzvLxMmO.js","assets/worker-X3JoFKas.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
