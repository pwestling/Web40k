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
const VERSION = "1c1f6bfdaff6";
const FILES = ["assets/Board-_XsIB2Ay.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-CdHGXrwT.js","assets/CommandPanel-DWjxsroe.js","assets/CommandPanel-fY9r1ar9.js","assets/Editor-BtW3o-WO.js","assets/EventSeat-D0YZVt9y.js","assets/EventsUI-CgKyj_8k.js","assets/FigureLibrary-B0MKskNP.js","assets/GameScreen-Bihs6tHe.js","assets/MailLobby-Db9aAsqQ.js","assets/Miniatures-SIZO8ZDJ.js","assets/OpenTables-DQjyZBfS.js","assets/PhotoMatch-BpFlbpAo.js","assets/PlayerCard-CyEEt7g3.js","assets/RankedGame-DYBSZHZd.js","assets/RulesPage-B-8Je7Ts.js","assets/StandeeMaker-C2zJuMk7.js","assets/TeachRule-DAshAEZv.js","assets/Workshop-CgsWAyRE.js","assets/_virtual_sandbox-worker-DwNs7aqq.js","assets/_virtual_soak-worker-BvAey2xi.js","assets/actions-DhzoYKoR.js","assets/aws4fetch.esm-BLUAl4pF.js","assets/base64-gMTPUZJI.js","assets/book-DMEURK2D.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CZky51Uj.js","assets/core-D-UGyuWg.js","assets/de-DGzklEPr.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-qvOJhGA3.js","assets/files-CdfAAl3C.js","assets/fr-DGTGRX0m.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-D9gS2Igy.js","assets/help-Df6mWeAo.js","assets/http-oPYN040A.js","assets/idb-OWIpJU7O.js","assets/index-DDlpmf3q.css","assets/index-Q-JN-xH1.js","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-CsfEhb5x.js","assets/lesson-CUbYscpM.js","assets/levels-DlkUqTaf.js","assets/local-2qsd__zl.js","assets/mailbox-KyEM-p5V.js","assets/manifest-BRIPGYy3.js","assets/meshShape-DLV-0yaT.js","assets/nostr-CYc8poBV.js","assets/pack-D61maXxC.js","assets/packageChange-Be729-6H.js","assets/page-DUOzWb0Q.js","assets/play-DcAyNj52.js","assets/post-z796i41V.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-C50Dyzez.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/react-hsrUxga6.js","assets/replayFile-GdEcx8_J.js","assets/report-N8Jk_MAn.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CVZButfQ.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelfActions-DkY_8Nd1.js","assets/showcase-Dcyx4k9V.js","assets/site-B823XLVz.js","assets/sound-DnWZ7vN-.js","assets/standIns-BHeYT5qd.js","assets/store-BR6m4p9O.js","assets/store-BylyVIVL.js","assets/store-CHH2UUXw.js","assets/store-D0GAPo1D.js","assets/store-DjE4x3J5.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-CsFOSdzS.js","assets/talk-ChMuM1hb.js","assets/three.module-BnHMTVNq.js","assets/thumb-5hq2fzzs.js","assets/trystero-CD6ReOpw.js","assets/trystero-DdX1lGgb.js","assets/trystero-dNljToKp.js","assets/webtorrent.min-DeIqevk6.js","assets/worker-Cbdv4p1W.js","assets/worker-CeH-QRv7.js","assets/worker-CtrB5Iye.js","assets/worker-DV1DuzPc.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
