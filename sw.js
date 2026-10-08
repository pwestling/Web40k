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
const VERSION = "e56fcb0720cb";
const FILES = ["assets/Board-D6Q4uXoD.js","assets/CommandPanel-BR8FzmbN.js","assets/Editor-CqlmM_pc.js","assets/FigureLibrary-B9FydkiG.js","assets/GameScreen-DibUxSJ4.js","assets/MailLobby-G-LJXmcH.js","assets/Miniatures-8tjJQqHB.js","assets/Workshop-Byi0AtCp.js","assets/_virtual_sandbox-worker-D6xWrhV9.js","assets/_virtual_soak-worker-oc6KlO4X.js","assets/base64-gMTPUZJI.js","assets/browser-bopAeLbn.js","assets/codec-D2EJBc5v.js","assets/de-CcAxKrqw.js","assets/dist-BQvHYO-j.js","assets/dist-D0EAIOa9.js","assets/dist-zGdHVkL9.js","assets/fr-BMDR7vPM.js","assets/fxp-CNHNYw_7.js","assets/gameLog-BaQorCue.js","assets/idb-BEIq6Y_P.js","assets/index-1ZAiH9SX.js","assets/index-BTqkOk3l.css","assets/jsx-runtime-BtH0gOTJ.js","assets/lesson-BTya3X2c.js","assets/levels-DlkUqTaf.js","assets/library-CcfMx9FR.js","assets/library-zFVU0dZL.js","assets/local-CeceiYJH.js","assets/react-DB-4Zxce.js","assets/replayFile-o29FkifS.js","assets/rift-lanterns-DEkpVqNJ.js","assets/runtime-D3HWHzM6.js","assets/scheduler-pDGbHDo7.js","assets/showcase-DSbypAr2.js","assets/store-Bf2VSPVP.js","assets/store-DkErQtO7.js","assets/store-DpzxiMvA.js","assets/syntax-CQBQa3WW.js","assets/talk-OlhqucXw.js","assets/trystero-DnzH19eq.js","assets/version-MCxBTql6.js","assets/worker-DG9I0sOt.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
