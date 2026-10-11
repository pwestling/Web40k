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
const VERSION = "e19b36527b2b";
const FILES = ["assets/Board-CxWPSBYQ.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-BBZYobPq.js","assets/CommandPanel-DeuDR_My.js","assets/CommandPanel-nM6H79CS.js","assets/Editor-z2U3rE5q.js","assets/EventSeat-CWb3dSNc.js","assets/EventsUI-6glaWRvx.js","assets/FigureLibrary-BPAr3pg2.js","assets/GameScreen-CemlJiuN.js","assets/MailLobby-BqO28MNm.js","assets/Miniatures-n6WebzHT.js","assets/OpenTables-i5wsB6eC.js","assets/PhotoMatch-BrSzzvFy.js","assets/PlayerCard-BwqTJaRY.js","assets/RankedGame-CttYwx75.js","assets/RulesPage-CgwsO4Dv.js","assets/StandeeMaker-NLnA0eAn.js","assets/TeachRule-Dtyvfpim.js","assets/Workshop-C6mrhpjl.js","assets/_virtual_sandbox-worker-CJOrGCtB.js","assets/_virtual_soak-worker-CmiEZD2I.js","assets/actions-Bit4o4w_.js","assets/aws4fetch.esm-BLUAl4pF.js","assets/base64-gMTPUZJI.js","assets/book-4sxilK0I.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CZky51Uj.js","assets/core-B2CLSqja.js","assets/de-Cz1twRoy.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-qvOJhGA3.js","assets/files-CdfAAl3C.js","assets/fr-e4Yxzj1o.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-BKMpeYgG.js","assets/help-DyRWeHU6.js","assets/http-BcZxXzrc.js","assets/idb-OWIpJU7O.js","assets/index-CDtvcmUF.js","assets/index-D-3pV7jZ.css","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-opRO0ehl.js","assets/lesson-Ce27dHTG.js","assets/levels-DlkUqTaf.js","assets/local-CzauMRI3.js","assets/mailbox-CeUKE15G.js","assets/manifest-BRIPGYy3.js","assets/meshShape-Cu8CnTAv.js","assets/nostr-0d1MIPmJ.js","assets/pack-Ck56xww5.js","assets/packageChange-Be729-6H.js","assets/page-BRuuuyxF.js","assets/play-CAaIDa4R.js","assets/post-DxQlA-MQ.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-ByZHvAzV.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/react-hsrUxga6.js","assets/replayFile-CB2w1IdY.js","assets/report-D2hBaedC.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CVZButfQ.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelfActions-qzSUi2KN.js","assets/showcase-Dcyx4k9V.js","assets/site-B823XLVz.js","assets/sound-BJP4pGC9.js","assets/standIns-BHeYT5qd.js","assets/store-7rQ0Y-Q9.js","assets/store-BAQqnNDh.js","assets/store-CYSYVZrZ.js","assets/store-D0eITAbY.js","assets/store-Dp-GCnru.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-CcV2twO6.js","assets/talk-BKDv4d6y.js","assets/three.module-BnHMTVNq.js","assets/thumb-CPq5LSle.js","assets/trystero-CFvwr2wF.js","assets/trystero-dNljToKp.js","assets/trystero-kFH-Rz5s.js","assets/webtorrent.min-DeIqevk6.js","assets/worker-CtrB5Iye.js","assets/worker-DV1DuzPc.js","assets/worker-IbP30w9H.js","assets/worker-TMXvtGaz.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
