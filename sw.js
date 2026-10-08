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
const VERSION = "4c7b7afcf24c";
const FILES = ["assets/Board-Ch-gvDsc.js","assets/CommandPanel-DPxLvBie.js","assets/CommandPanel-DnW8rz4x.js","assets/Editor-_Q0Qexdm.js","assets/FigureLibrary-_w8NR9OR.js","assets/GameScreen-CXCEcHXz.js","assets/MailLobby-CvK2G8EA.js","assets/Miniatures-Cts-YfFA.js","assets/TableWarnings-Dp2YMqM9.js","assets/Workshop-OAnzrojP.js","assets/_virtual_sandbox-worker-Cjt_TFaM.js","assets/_virtual_soak-worker-D8QEhXje.js","assets/base64-gMTPUZJI.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/charge-DBGr8SOw.js","assets/codec-D2EJBc5v.js","assets/de-C1JAvxXi.js","assets/dist-D0EAIOa9.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/events-9ce18a08.esm-BZFvChV6.js","assets/fr-BKBpmwi7.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-Dwzu0ZXq.js","assets/idb-DaSctRIg.js","assets/index-BfXHhdT5.css","assets/index-WYl0tabU.js","assets/jsx-runtime-BtH0gOTJ.js","assets/lesson-BMXoJXC5.js","assets/levels-DlkUqTaf.js","assets/library-DXgfpv-u.js","assets/local-BmL9Wx9d.js","assets/page--rMvVBLS.js","assets/react-DB-4Zxce.js","assets/replayFile-XQ01C9El.js","assets/rift-lanterns-BYDQqtdB.js","assets/rolldown-runtime-CbXtAM7H.js","assets/scheduler-pDGbHDo7.js","assets/showcase-xukfZ8eB.js","assets/store-BSd3uQWQ.js","assets/store-D5Pcu2ln.js","assets/store-RMDYz2LV.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-BeOzcwbd.js","assets/talk-W2qPSAIr.js","assets/trystero-D3FnH1Kl.js","assets/trystero-DYVC-IfJ.js","assets/version-DDYxM4k8.js","assets/worker-BB97BS7F.js","assets/worker-X3JoFKas.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
