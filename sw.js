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
const VERSION = "c5f800554729";
const FILES = ["assets/Board-BW5iMDvl.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-9aTc8Jo8.js","assets/CommandPanel-BJlKKTpz.js","assets/CommandPanel-Cq4Z5t2R.js","assets/Editor-DMvIGI2n.js","assets/EventSeat-BAVg32dZ.js","assets/EventsUI-DKXQhPjh.js","assets/FigureLibrary-DKQ2CUK_.js","assets/GameScreen-CQaQ5qnX.js","assets/MailLobby-DXlyVfnp.js","assets/Miniatures-vncAxhVP.js","assets/OpenTables-DnquD_Nr.js","assets/PhotoMatch-PtGEt0Jx.js","assets/PlayerCard-BZ07mjfc.js","assets/RankedGame-Z9rhn2NG.js","assets/RulesPage-CtAhQ8kg.js","assets/StandeeMaker-BTlh2G5r.js","assets/TableWarnings-C4oRjyHl.js","assets/Workshop-PjJNWfjL.js","assets/_virtual_sandbox-worker-BlyBgWG4.js","assets/_virtual_soak-worker-B_YOeGMT.js","assets/actions-DWIdkqtF.js","assets/aws4fetch.esm-BLUAl4pF.js","assets/base64-gMTPUZJI.js","assets/book-CDWT-pCz.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CZky51Uj.js","assets/core-D8xl_ASq.js","assets/de-sS9pDUBo.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-qvOJhGA3.js","assets/files-CdfAAl3C.js","assets/fr-BczOlxx7.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-C-cJUUc4.js","assets/help-CvSAsMEE.js","assets/http-CvX8uaFT.js","assets/idb-OWIpJU7O.js","assets/index-BZ0vitSs.css","assets/index-DSTo-CSJ.js","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-Ba3X8YzT.js","assets/lesson-BkGWJB-C.js","assets/levels-DlkUqTaf.js","assets/local-DcNzbO7p.js","assets/mailbox-DmEA4cV2.js","assets/manifest-bE-32xpp.js","assets/meshShape-Dusk4nSo.js","assets/nostr-DBl3rhTa.js","assets/pack-CcPqoshH.js","assets/packageChange-Be729-6H.js","assets/page-DJtlj5-T.js","assets/play-DP-vAizR.js","assets/post-BZPVUO1Q.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-C5GDQ6Ml.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/react-hsrUxga6.js","assets/replayFile-DsnTnU0D.js","assets/report-C-5dp7M4.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CVZButfQ.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelfActions-y9sAjC36.js","assets/showcase-Dcyx4k9V.js","assets/site-B823XLVz.js","assets/sound-DnWZ7vN-.js","assets/standIns-BHeYT5qd.js","assets/store-BSFGPfI-.js","assets/store-B_utIP3s.js","assets/store-CaUkUa7N.js","assets/store-DA_rIiYb.js","assets/store-mYueJt_b.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-ym-jAK_v.js","assets/talk-BCuVVyCd.js","assets/three.module-BnHMTVNq.js","assets/thumb-BT1_0RnY.js","assets/trystero-YGDdNo5O.js","assets/trystero-_ruSQwMd.js","assets/trystero-dNljToKp.js","assets/webtorrent.min-DeIqevk6.js","assets/worker-BKModwEd.js","assets/worker-CDSLbQc9.js","assets/worker-CtrB5Iye.js","assets/worker-DV1DuzPc.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
