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
const VERSION = "f88101fa2b9d";
const FILES = ["assets/Board-Cuw195rz.js","assets/CommandPanel-75h44HLJ.js","assets/Editor-C23XfVTO.js","assets/FigureLibrary-BlSVQvBI.js","assets/GameScreen-C2F68f9e.js","assets/MailLobby-B7Ke-2u5.js","assets/Miniatures-TE0H_ntW.js","assets/TableWarnings-CkYLHSwe.js","assets/Workshop-Cmm0-8-w.js","assets/_virtual_sandbox-worker-D8pb-Gsu.js","assets/_virtual_soak-worker-DY7W5nz7.js","assets/base64-gMTPUZJI.js","assets/browser-bopAeLbn.js","assets/charge-DHqFNZZM.js","assets/codec-D2EJBc5v.js","assets/de-BYfs59C9.js","assets/dist-D0EAIOa9.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/events-9ce18a08.esm-DbiVK6tG.js","assets/fr-B27OXabh.js","assets/fxp-CNHNYw_7.js","assets/gameLog-CleBya03.js","assets/idb-BbIBzxon.js","assets/index-BP3yagTI.css","assets/index-C9YkvxAA.js","assets/jsx-runtime-BtH0gOTJ.js","assets/lesson-BqOdX41S.js","assets/levels-DlkUqTaf.js","assets/library-C6AXJc2o.js","assets/local-BqTRAJmg.js","assets/page-CIgAJAVA.js","assets/react-DB-4Zxce.js","assets/replayFile-BGTjPX_f.js","assets/rift-lanterns-BYDQqtdB.js","assets/scheduler-pDGbHDo7.js","assets/showcase-VIlD2KG3.js","assets/store-BbtvhztT.js","assets/store-CJTfxlCq.js","assets/store-k5VF_9DD.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-BsjZ2RIr.js","assets/talk-KJrq_SWf.js","assets/trystero-B97BiKrM.js","assets/version-D-S9ddGr.js","assets/worker-X3JoFKas.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
