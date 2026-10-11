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
const VERSION = "57fd43e53db1";
const FILES = ["assets/Board-BrlhZ1p1.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-B68YawpU.js","assets/CommandPanel-D1N9TxML.js","assets/CommandPanel-rcIC7RP4.js","assets/Editor-DVw4ysCO.js","assets/EventSeat-C-BWI_xr.js","assets/EventsUI-Bd0gSUlH.js","assets/FigureLibrary-DHN4rhrj.js","assets/GameScreen-DfxYtdMN.js","assets/MailLobby-DtPEPyrn.js","assets/Miniatures-BVSkUy8K.js","assets/OpenTables-zGRS6HTp.js","assets/PhotoMatch-Bw7Wr9AF.js","assets/PlayerCard-DF1xaKl3.js","assets/RankedGame-C6QfAGDk.js","assets/RulesPage-DQe6-FbL.js","assets/StandeeMaker-BD-wSmtO.js","assets/TeachRule-DDP37dea.js","assets/Workshop-CQ_M6Jy8.js","assets/_virtual_sandbox-worker-Blti5ew3.js","assets/_virtual_soak-worker-DxtoDw_3.js","assets/actions-CXMm3i3b.js","assets/aws4fetch.esm-BLUAl4pF.js","assets/base64-gMTPUZJI.js","assets/book-DXx4UY1s.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CZky51Uj.js","assets/core-iW3BDgcj.js","assets/de-BmnMxgo8.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-qvOJhGA3.js","assets/files-CdfAAl3C.js","assets/fr-ke2MD4_1.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-BjaY5MWP.js","assets/help-kmAUEaG3.js","assets/http-CqpIu2z7.js","assets/idb-OWIpJU7O.js","assets/index-Bpump19h.js","assets/index-Cx3-Bc6E.css","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-CT7xpfoT.js","assets/lesson-BHMV7hYA.js","assets/levels-DlkUqTaf.js","assets/local-DjlTH6bV.js","assets/mailbox-BLE-65Gg.js","assets/manifest-BRIPGYy3.js","assets/meshShape-BvHIFPOA.js","assets/nostr-d6hV9Dhj.js","assets/pack-Dy-glbGe.js","assets/packageChange-Be729-6H.js","assets/page-ChtbErWs.js","assets/play-CHoHGpz0.js","assets/post-Cyq-yOFs.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-D2DKaRUU.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/react-hsrUxga6.js","assets/replayFile-Dpdkbu09.js","assets/report-D9WFwssG.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CVZButfQ.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelfActions-CIYWn_Si.js","assets/showcase-Dcyx4k9V.js","assets/site-B823XLVz.js","assets/sound-BYXSO4hD.js","assets/standIns-BHeYT5qd.js","assets/store-Dz2jH-k1.js","assets/store-a-Fnt4Rr.js","assets/store-pZL7dzpC.js","assets/store-pnBdYWL8.js","assets/store-xOa7JkTh.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-DMOxFqMV.js","assets/talk-DDZjLldU.js","assets/three.module-BnHMTVNq.js","assets/thumb-Dgq1Vvz4.js","assets/trystero-DI1hOxtz.js","assets/trystero-dNljToKp.js","assets/trystero-p00SzSFp.js","assets/webtorrent.min-DeIqevk6.js","assets/worker-CEVYkNNF.js","assets/worker-CtrB5Iye.js","assets/worker-DEZXpM4g.js","assets/worker-DV1DuzPc.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
