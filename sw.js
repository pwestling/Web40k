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
const VERSION = "33404a0643a3";
const FILES = ["assets/Board-BeJx9Yxk.js","assets/BufferGeometryUtils-xZWDoXM5.js","assets/CommandPanel-B29XoPrP.js","assets/CommandPanel-B5ee53eq.js","assets/CommandPanel-BL5a3PLH.js","assets/Editor-B2_v2_Rv.js","assets/FigureLibrary-D37MuP8x.js","assets/GameScreen-DM5JHb3V.js","assets/MailLobby-C5LbxbCn.js","assets/Miniatures-BVyB6eBs.js","assets/OpenTables-Cg4dHVri.js","assets/Packages-otUMJ-eq.js","assets/RulesPage-oRr-bia8.js","assets/TableWarnings-Dl8YV7Mv.js","assets/Workshop-BY-83UAL.js","assets/_virtual_sandbox-worker-C9Fx29mw.js","assets/_virtual_soak-worker-v4z-JIwK.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/checksum-DJRaK3BZ.js","assets/codec-DOoWeNvh.js","assets/config-CEb1gVoU.js","assets/core-ClN6-Na-.js","assets/de-P9JlT9WB.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/events-9ce18a08.esm-B1BlC6rD.js","assets/files-CdfAAl3C.js","assets/fr-wI3r1hZJ.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-CtFsv3F3.js","assets/help-eEON2cl5.js","assets/hooks-BKvaq0bx.js","assets/http-DqvcuV9S.js","assets/index-DdGuaDey.css","assets/index-lZW8_kU_.js","assets/jsx-runtime-NZYk81nU.js","assets/layout-C56xVAJT.js","assets/lesson-_g6BoJNT.js","assets/levels-DlkUqTaf.js","assets/local-B9Bht0Fn.js","assets/mailbox-C117kIDF.js","assets/nostr-B_sKeyG2.js","assets/page-rbSmUq1q.js","assets/post-nqb2b8xm.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-BmBJYn5X.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-CHYlBbMv.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CpK43PLW.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/setup-CrKlhmtF.js","assets/shelf-CmMjh0wF.js","assets/showcase-BT2mg1sx.js","assets/site-B823XLVz.js","assets/sound-C7rVYV3J.js","assets/standIns-OXIxWlRR.js","assets/store-C5a0_Kqd.js","assets/store-D73Mlcdk.js","assets/syntax-CEL_Wvla.js","assets/talk-wuObP477.js","assets/three.module-B9uX-pKs.js","assets/trystero-BFq5-H4G.js","assets/trystero-BrMl_Sv3.js","assets/worker-AQWcDUvV.js","assets/worker-C6cfKwMt.js","assets/worker-X3JoFKas.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
