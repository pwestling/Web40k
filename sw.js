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
const VERSION = "0d487c9acad6";
const FILES = ["assets/Board-9wJNTP41.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-Clk580PS.js","assets/CommandPanel-Ct0Ou5IR.js","assets/CommandPanel-D4cdJI86.js","assets/Editor-BBLZy48q.js","assets/EventSeat-BYHHKJCt.js","assets/EventsUI-D3r7n6AU.js","assets/FigureLibrary-DJSeor3H.js","assets/GameScreen-F5vOuC9R.js","assets/MailLobby-CJJK2Yjs.js","assets/Miniatures-C3LsPkrI.js","assets/OpenTables-DfQB6X2x.js","assets/PhotoMatch-6Y6_cbAm.js","assets/PlayerCard-CvRmxr9C.js","assets/RankedGame-D8tmsi92.js","assets/RulesPage-gdPl_AGG.js","assets/StandeeMaker-GoCbZaOr.js","assets/TableWarnings-BRGApHIF.js","assets/Workshop-DwFJ9JY0.js","assets/_virtual_sandbox-worker-BC2NVjiQ.js","assets/_virtual_soak-worker-C7rDgf5w.js","assets/base64-gMTPUZJI.js","assets/book-DsgMshFA.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-AczWdb9g.js","assets/core-0hmS_wHC.js","assets/de-BbGzzwxy.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-BoKMkqUi.js","assets/files-CdfAAl3C.js","assets/fr-Ck_1Nclx.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-aeoxerze.js","assets/help-CbCc83rS.js","assets/http-DGMM11Ne.js","assets/idb-OWIpJU7O.js","assets/index-CHiKOhTo.css","assets/index-Cnp04p3V.js","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-qsLS-NIp.js","assets/lesson-H9unU3X5.js","assets/levels-DlkUqTaf.js","assets/local-BKpUSqgL.js","assets/mailbox-ChVdhhSz.js","assets/meshShape-BN75Zvad.js","assets/nostr-B1jA3Jgq.js","assets/packageChange-Be729-6H.js","assets/page-DREa5Iy2.js","assets/play-BgJQkxiz.js","assets/post-CtIl8ljW.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-Doo989AA.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-DMPpcZDh.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CVZButfQ.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/showcase-DYSB8S8W.js","assets/site-B823XLVz.js","assets/sound-BBiSJ-uA.js","assets/standIns-BHeYT5qd.js","assets/store-CaG4-VOV.js","assets/store-DAdyhdzP.js","assets/store-DLJQaLXc.js","assets/store-wOCeEKSR.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-BMPupdLT.js","assets/talk-DVUHYP3O.js","assets/three.module-BnHMTVNq.js","assets/thumb-VQq1Knhu.js","assets/trystero-Chre6IBw.js","assets/trystero-D8Wph1NH.js","assets/worker-Ct6ml9Ao.js","assets/worker-CtrB5Iye.js","assets/worker-DV1DuzPc.js","assets/worker-DaEmdkS_.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
