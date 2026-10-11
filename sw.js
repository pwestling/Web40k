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
const VERSION = "506ccd9b975b";
const FILES = ["assets/Board-vSOR4y2S.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-C2mhtR4v.js","assets/CommandPanel-CnV-X_hv.js","assets/CommandPanel-Dm33jFJ-.js","assets/Editor-BqtM6ELA.js","assets/EventSeat-CvnmykzX.js","assets/EventsUI-CHlCVxAj.js","assets/FigureLibrary-De6YYHCl.js","assets/GameScreen-BuTx_NCC.js","assets/MailLobby-Bg8c-0V9.js","assets/Miniatures-DM5agDkq.js","assets/OpenTables-D1keHSw8.js","assets/PhotoMatch-CAxrchkR.js","assets/PlayerCard-DojgCLQc.js","assets/RankedGame-Bpm5TpNu.js","assets/RulesPage-CLoZM_1p.js","assets/StandeeMaker-CiH6wqz3.js","assets/TeachRule-CABZQhl9.js","assets/Workshop-eDJ08M93.js","assets/_virtual_sandbox-worker-DjOL8jhh.js","assets/_virtual_soak-worker-BpUKHYLs.js","assets/actions-DcB0Ne3J.js","assets/aws4fetch.esm-BLUAl4pF.js","assets/base64-gMTPUZJI.js","assets/book-B-H4bGFB.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CZky51Uj.js","assets/core-C_xNKOGC.js","assets/de-DeImonnx.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-qvOJhGA3.js","assets/files-CdfAAl3C.js","assets/fr-DvZXKqUh.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-ejd6OIiJ.js","assets/help-CJ8bJ2WY.js","assets/http-BQ0Iomjl.js","assets/idb-OWIpJU7O.js","assets/index-BrElkLzk.css","assets/index-DfA334v7.js","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-BXTnANmx.js","assets/lesson-BUUOemKx.js","assets/levels-DlkUqTaf.js","assets/local-D05UyrLW.js","assets/mailbox-Bb2u_w6u.js","assets/manifest-BRIPGYy3.js","assets/meshShape-Dur66JX_.js","assets/nostr-BKXg1cXK.js","assets/pack-FUfMxVoC.js","assets/packageChange-Be729-6H.js","assets/page-D0KghX-r.js","assets/play-BWSO_wpx.js","assets/post-ZXwzspkr.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-BNkoLg1f.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/react-hsrUxga6.js","assets/replayFile-BFeNiigX.js","assets/report-DTDyWiCu.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CVZButfQ.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelfActions-Feew7rNe.js","assets/showcase-Dcyx4k9V.js","assets/site-B823XLVz.js","assets/sound-BYXSO4hD.js","assets/standIns-BHeYT5qd.js","assets/store-CNO6SLNa.js","assets/store-CNe4TvfE.js","assets/store-CoDiXMM7.js","assets/store-D3HQWmGT.js","assets/store-w6LhE4dB.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-BzHeljLf.js","assets/talk-DOh5xPYt.js","assets/three.module-BnHMTVNq.js","assets/thumb-mW6-NG6k.js","assets/trystero-DrnaFhj3.js","assets/trystero-dNljToKp.js","assets/trystero-peyB22IT.js","assets/webtorrent.min-DeIqevk6.js","assets/worker-C1QdrjcQ.js","assets/worker-CtrB5Iye.js","assets/worker-DV1DuzPc.js","assets/worker-DZJdSUa4.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
