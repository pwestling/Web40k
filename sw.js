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
const VERSION = "ef8f152f4ecd";
const FILES = ["assets/Board-vtmjXEA8.js","assets/CommandPanel-BLyQyugq.js","assets/CommandPanel-DO61laMv.js","assets/Editor-uFsKPmtu.js","assets/FigureLibrary-C8cP_fNW.js","assets/GameScreen-BMdbPRFQ.js","assets/MailLobby-DO3_AkwH.js","assets/Miniatures-SqPe23-w.js","assets/TableWarnings-DpsAG5Hv.js","assets/Workshop-D4RCt7hz.js","assets/_virtual_sandbox-worker-DYauHEXM.js","assets/_virtual_soak-worker-CyX_HwzU.js","assets/base64-gMTPUZJI.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/charge-ChS_TK-G.js","assets/codec-D2EJBc5v.js","assets/de-D_G_4Ph_.js","assets/dist-D0EAIOa9.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/events-9ce18a08.esm-uz2Eer7z.js","assets/fr-CnF3cNuo.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-tjZwnrRd.js","assets/idb-CQC-YI19.js","assets/index-BfXHhdT5.css","assets/index-crNNo5g9.js","assets/jsx-runtime-BtH0gOTJ.js","assets/lesson-B35WfOqR.js","assets/levels-DlkUqTaf.js","assets/library-DdZB6pCT.js","assets/local-Cp6d-4FK.js","assets/page-HG2v4Xhm.js","assets/react-DB-4Zxce.js","assets/replayFile-BLYNgFx0.js","assets/rift-lanterns-BYDQqtdB.js","assets/rolldown-runtime-CbXtAM7H.js","assets/scheduler-pDGbHDo7.js","assets/showcase-By3xO_tE.js","assets/store-B9msSq8K.js","assets/store-BZLpi8nk.js","assets/store-DWKDFAlc.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-D_QnOrk7.js","assets/talk-DX29ThIW.js","assets/trystero-D-FOpLm-.js","assets/trystero-DYVC-IfJ.js","assets/version-DFjst4Rw.js","assets/worker-DPQgFdYj.js","assets/worker-X3JoFKas.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
