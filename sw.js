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
const VERSION = "d7d0d546e219";
const FILES = ["assets/Board-D2nHD84C.js","assets/CommandPanel-C-8Qn-ZJ.js","assets/Editor-DUqMu2_A.js","assets/FigureLibrary-DIIKFJCm.js","assets/GameScreen-D-v0SGKC.js","assets/MailLobby-CiMTA9PO.js","assets/Miniatures-DhnrZ4fP.js","assets/Workshop-ybr39sXG.js","assets/_virtual_sandbox-worker-CU15X0uT.js","assets/_virtual_soak-worker-DMMa6taV.js","assets/base64-gMTPUZJI.js","assets/browser-bopAeLbn.js","assets/charge-BqdSS43Q.js","assets/codec-D2EJBc5v.js","assets/de-C4IHMbBx.js","assets/dist-D0EAIOa9.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/events-9ce18a08.esm-_iZAP_P8.js","assets/fr-aiPGmwlK.js","assets/fxp-CNHNYw_7.js","assets/gameLog-GlX7edpo.js","assets/idb-BzChSBy3.js","assets/index-DN-jvbRC.css","assets/index-uVUGnQZG.js","assets/jsx-runtime-BtH0gOTJ.js","assets/lesson-B7RRvJMt.js","assets/levels-DlkUqTaf.js","assets/library-CBcvKA40.js","assets/local-CuVtvE5D.js","assets/page-BMJAq-Gf.js","assets/react-DB-4Zxce.js","assets/replayFile-DfD12AuK.js","assets/rift-lanterns-BYDQqtdB.js","assets/runtime-jcR8WF2d.js","assets/scheduler-pDGbHDo7.js","assets/showcase-BJ-2tP6b.js","assets/store-C6DDz-bf.js","assets/store-CWi4ZHMs.js","assets/store-DuASkDKa.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-CTfG2f5v.js","assets/talk-SY7Dhmnl.js","assets/trystero-8Z39g_wr.js","assets/version-HsswQmJ8.js","assets/worker-X3JoFKas.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
