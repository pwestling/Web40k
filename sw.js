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
const VERSION = "a28a65091884";
const FILES = ["assets/Board-B0spZ2j9.js","assets/BufferGeometryUtils-xZWDoXM5.js","assets/CommandPanel-BWK9hRaH.js","assets/CommandPanel-CUEPYKeo.js","assets/Editor-DHkS2Etn.js","assets/FigureLibrary-Dy1Qpb95.js","assets/GameScreen-yT4s-IPB.js","assets/MailLobby-DdXAggN7.js","assets/Miniatures-CojNguqR.js","assets/Packages-Bae_WKWB.js","assets/RulesPage-Xpcaqc-V.js","assets/TableWarnings-DjuOi1LW.js","assets/Workshop-DY6RVVfR.js","assets/_virtual_sandbox-worker-BQlXiJMA.js","assets/_virtual_soak-worker-hfsrYVfn.js","assets/base64-gMTPUZJI.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/charge-DO6Y2D1b.js","assets/codec-DOoWeNvh.js","assets/de-C7B8WTX3.js","assets/dist-D0EAIOa9.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/events-9ce18a08.esm-D9jdLcXI.js","assets/files-CdfAAl3C.js","assets/fr-CciSkAIW.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-pa14eIQn.js","assets/hooks-DBCZsa0M.js","assets/index-Bzz0v-p-.css","assets/index-CwkmroCu.js","assets/jsx-runtime-NZYk81nU.js","assets/layout-B9mToAEL.js","assets/lesson-CKa2fvy5.js","assets/levels-DlkUqTaf.js","assets/local-BJYsx2k4.js","assets/packageChange-Be729-6H.js","assets/page-I1ZvLIaJ.js","assets/printPlay-Ciu2M7aw.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-Bu4xj_9n.js","assets/rift-lanterns-BrpR-PPJ.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/scheduler-C784v2VA.js","assets/site-B823XLVz.js","assets/standIns-OXIxWlRR.js","assets/store-B-MjlaRg.js","assets/store-BgiXz9pm.js","assets/store-CKBeE930.js","assets/syntax-CEL_Wvla.js","assets/talk-CPctGENN.js","assets/three.module-B9uX-pKs.js","assets/trystero-DAg4ASRY.js","assets/trystero-DYVC-IfJ.js","assets/worker-X3JoFKas.js","assets/worker-aQA8TzKd.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
