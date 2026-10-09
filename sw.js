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
const VERSION = "adc9953daf18";
const FILES = ["assets/Board-6R-hOCsI.js","assets/BufferGeometryUtils-xZWDoXM5.js","assets/CommandPanel-BV7uIQ2n.js","assets/CommandPanel-DTn_bLWF.js","assets/Editor-DSbjVIQT.js","assets/FigureLibrary-XE1AwVJt.js","assets/GameScreen-DwI4QOOk.js","assets/MailLobby-DCaemIPJ.js","assets/Miniatures-BfwRrXGN.js","assets/OpenTables-D8673o5e.js","assets/Packages-BbOX3nci.js","assets/RulesPage-zaHNyUYn.js","assets/TableWarnings-CYcScTYZ.js","assets/Workshop-DZHiSdPl.js","assets/_virtual_sandbox-worker-DderZx-U.js","assets/_virtual_soak-worker-DEg4DoaA.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/checksum-B9s_4xdE.js","assets/codec-DOoWeNvh.js","assets/config-Cqo63nnv.js","assets/core-DjwTQytQ.js","assets/de-salVhFef.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/events-9ce18a08.esm-Bld0khcr.js","assets/files-CdfAAl3C.js","assets/fr-iZdSZptX.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-B0ru2TOH.js","assets/hooks-BG5HF_2o.js","assets/http-SBGBMaWD.js","assets/index-DcCOChpt.js","assets/index-nkiaegDR.css","assets/jsx-runtime-NZYk81nU.js","assets/layout-BfZGfJG2.js","assets/lesson-CZyXEfar.js","assets/levels-DlkUqTaf.js","assets/local-4R8K1Wqy.js","assets/mailbox-D5px8FaX.js","assets/nostr-DnUi2a51.js","assets/page-oI_Zg7Dv.js","assets/post-DuHitjy3.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-DQz218wv.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-Cjt5j199.js","assets/rift-lanterns-Caf6oLxO.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CpK43PLW.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelf-DnbRKBU4.js","assets/site-B823XLVz.js","assets/sound-BoKCmwOI.js","assets/standIns-OXIxWlRR.js","assets/store-BYXDDuKg.js","assets/store-DTFSTmJb.js","assets/syntax-CEL_Wvla.js","assets/talk-CCpuKAvt.js","assets/three.module-B9uX-pKs.js","assets/trystero-DWViwSsW.js","assets/trystero-U-wyGnZX.js","assets/worker-X3JoFKas.js","assets/worker-YwtprebK.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
