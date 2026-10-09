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
const VERSION = "6a7e3eb2e79d";
const FILES = ["assets/Board-DJQseBvT.js","assets/BufferGeometryUtils-xZWDoXM5.js","assets/CommandPanel-C4yit57b.js","assets/CommandPanel-CZmHVwBO.js","assets/CommandPanel-uqqUxp3W.js","assets/Editor-lKHQV5Y0.js","assets/FigureLibrary-C6xPzL2V.js","assets/GameScreen-YYguKnQi.js","assets/MailLobby-BRhrNup5.js","assets/Miniatures-YMW5NUdL.js","assets/OpenTables-BMwZ2aow.js","assets/Packages-CeMSsWLb.js","assets/RulesPage-CXGCjSE0.js","assets/TableWarnings-Bo0AUsn8.js","assets/Workshop-DZzPPFDU.js","assets/_virtual_sandbox-worker-CK0LuVgk.js","assets/_virtual_soak-worker-BDi617iI.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/checksum-DJRaK3BZ.js","assets/codec-DOoWeNvh.js","assets/config-Cqo63nnv.js","assets/core-C4NdfLVC.js","assets/de-DW9ORuPm.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/events-9ce18a08.esm-Xl9SEq5P.js","assets/files-CdfAAl3C.js","assets/fr-GgvhHGcr.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-D5k3Aj0I.js","assets/help-eEON2cl5.js","assets/hooks-BUeklt9Y.js","assets/http-BaLv6N3j.js","assets/index-CLrAHLZ2.js","assets/index-Cqhmue9x.css","assets/jsx-runtime-NZYk81nU.js","assets/layout-B282m93j.js","assets/lesson-d2rDCpVQ.js","assets/levels-DlkUqTaf.js","assets/local-CzT0Bw6B.js","assets/mailbox-AztkXYLn.js","assets/nostr-lGtSg__r.js","assets/page-Dj73lyvN.js","assets/post-B4e4ji1G.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-BBXVgy-j.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-GeW6_Q-g.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CpK43PLW.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/setup-D9ulv--S.js","assets/shelf-BTT_PYfo.js","assets/showcase-BT2mg1sx.js","assets/site-B823XLVz.js","assets/sound-C7rVYV3J.js","assets/standIns-OXIxWlRR.js","assets/store-Cyb8OMjV.js","assets/store-DdXhK_Wn.js","assets/syntax-CEL_Wvla.js","assets/talk-BWA19IDv.js","assets/three.module-B9uX-pKs.js","assets/trystero-DWViwSsW.js","assets/trystero-U-wyGnZX.js","assets/worker-BHni1EOj.js","assets/worker-DW-SvrXk.js","assets/worker-X3JoFKas.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
