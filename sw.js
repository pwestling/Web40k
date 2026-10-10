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
const VERSION = "0e88d5532619";
const FILES = ["assets/Board-DRoGqMh_.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-DGp45fpH.js","assets/CommandPanel-Dld0wsGf.js","assets/CommandPanel-DpREEVIX.js","assets/Editor-CCdd2k1F.js","assets/EventSeat-DANqyRpt.js","assets/EventsUI-BVCgfLsd.js","assets/FigureLibrary-CYJK9t0-.js","assets/GameScreen-DQujVA0K.js","assets/MailLobby-txwLojed.js","assets/Miniatures-CtY61srF.js","assets/OpenTables-CbOqUqRN.js","assets/PhotoMatch-DifAwuX4.js","assets/PlayerCard-DaNiw71j.js","assets/RankedGame-DgDc-5D5.js","assets/RulesPage-DXb4BdeY.js","assets/StandeeMaker-B5Y8Mc7L.js","assets/TableWarnings-Cb2sRtqI.js","assets/Workshop-Cd6ltJ1v.js","assets/_virtual_sandbox-worker-xTTm6j5_.js","assets/_virtual_soak-worker-B7dRxY-b.js","assets/base64-gMTPUZJI.js","assets/book-DR9bN59V.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CEb1gVoU.js","assets/core-DtEDjwNf.js","assets/de-DnbRfOsW.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-BoKMkqUi.js","assets/files-CdfAAl3C.js","assets/fr-BLKNQiHl.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-qEINltkG.js","assets/help-BGctcuhG.js","assets/hooks-DpEJPH1L.js","assets/http-DJOo9IDI.js","assets/idb-OWIpJU7O.js","assets/index-BtklHnJk.js","assets/index-EUhTXr_o.css","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-Bd1kN7be.js","assets/lesson-B8-ntZ3a.js","assets/levels-DlkUqTaf.js","assets/local-B2KdjgLP.js","assets/mailbox-a-SyFzQc.js","assets/meshShape-BbN2mLhJ.js","assets/nostr-B-cqqjzE.js","assets/packageChange-Be729-6H.js","assets/page-DabBXlNY.js","assets/play-D-sdAJGw.js","assets/post-D6FUev0j.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-D8WcfsBb.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-BMK-Ikms.js","assets/rift-lanterns-DLDKmR7R.js","assets/riftLanterns-BwCEW5S7.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-3qflJCEN.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/showcase-DDTyDm3p.js","assets/site-B823XLVz.js","assets/sound-7zEvz3rp.js","assets/standIns-BHeYT5qd.js","assets/store-BMNujAeN.js","assets/store-DJ8f7wTy.js","assets/store-DQGQiOm0.js","assets/store-DeqATaPl.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-DJraOtK-.js","assets/talk-Dss_pHGS.js","assets/three.module-BnHMTVNq.js","assets/thumb-jD01Cr1m.js","assets/trystero-BFq5-H4G.js","assets/trystero-BrMl_Sv3.js","assets/worker-CtrB5Iye.js","assets/worker-DIGBndlf.js","assets/worker-DV1DuzPc.js","assets/worker-cgkAhwm8.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
