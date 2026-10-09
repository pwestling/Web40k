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
const VERSION = "6fe2cedb5008";
const FILES = ["assets/Board-B7EUtYVo.js","assets/BufferGeometryUtils-xZWDoXM5.js","assets/CommandPanel-DML7-W08.js","assets/CommandPanel-DcPvvy4N.js","assets/CommandPanel-DejZbBqV.js","assets/Editor-BLLS_2Xz.js","assets/FigureLibrary-CxKeeqJH.js","assets/GameScreen-8DkPT8LA.js","assets/MailLobby-CO-Rc-RN.js","assets/Miniatures-BCbBywFg.js","assets/OpenTables-0yGhl-1t.js","assets/Packages-C0s4BWJK.js","assets/RulesPage-CZAKrhxV.js","assets/TableWarnings-BUvkIpWe.js","assets/Workshop-CmrKXJ6n.js","assets/_virtual_sandbox-worker-Cg5-eltq.js","assets/_virtual_soak-worker-C0QmYPFZ.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/checksum-DJRaK3BZ.js","assets/codec-DOoWeNvh.js","assets/config-Cqo63nnv.js","assets/core-Dl1yBDGp.js","assets/de-Cip1TfmL.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/events-9ce18a08.esm-CJb28u58.js","assets/files-CdfAAl3C.js","assets/fr-3ZPHUoi-.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-CrU3v4Xv.js","assets/help-eEON2cl5.js","assets/hooks-B_aEkOZS.js","assets/http-Fk7H9Z5D.js","assets/index-BIRs4pE6.js","assets/index-C6dt6yy4.css","assets/jsx-runtime-NZYk81nU.js","assets/layout-DDqvVjI-.js","assets/lesson-FpKSgtFQ.js","assets/levels-DlkUqTaf.js","assets/local-edo_Ix9g.js","assets/mailbox-DniYimE2.js","assets/nostr-ISc2-YzW.js","assets/page-BV0_ATd5.js","assets/post-CvIU4Gv-.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-BXNPQkLL.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-B30_r1qC.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CpK43PLW.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/setup-DfMTrRKY.js","assets/shelf-H6KmMH9O.js","assets/showcase-BT2mg1sx.js","assets/site-B823XLVz.js","assets/sound-C7rVYV3J.js","assets/standIns-OXIxWlRR.js","assets/store-B2-oemFH.js","assets/store-CWYLyJsm.js","assets/syntax-CEL_Wvla.js","assets/talk-BMIC93LJ.js","assets/three.module-B9uX-pKs.js","assets/trystero-DWViwSsW.js","assets/trystero-U-wyGnZX.js","assets/worker-DHjmV9fj.js","assets/worker-X3JoFKas.js","assets/worker-pc5hFkRQ.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
