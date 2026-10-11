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
const VERSION = "17ce3939fff3";
const FILES = ["assets/Board-CBjGLu4k.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-BONs5ffM.js","assets/CommandPanel-Bg0MzIaf.js","assets/CommandPanel-DPS3wAjg.js","assets/Editor-BKJrGkw7.js","assets/EventSeat-Cr2XLTj0.js","assets/EventsUI-YokBVOWI.js","assets/FigureLibrary-C4MCKv2O.js","assets/GameScreen-DQkX005x.js","assets/MailLobby-egXXcv93.js","assets/Miniatures-CgFMe-z3.js","assets/OpenTables-BiLxfQwB.js","assets/PhotoMatch-UGpdLQxQ.js","assets/PlayerCard-BifqUzy_.js","assets/RankedGame-Dd05S0rZ.js","assets/RulesPage-CAXJxo7c.js","assets/StandeeMaker-DUgaPp7u.js","assets/TeachRule-02qHIPu3.js","assets/Workshop-mmfPLJgx.js","assets/_virtual_sandbox-worker-CJOrGCtB.js","assets/_virtual_soak-worker-Cauq2E8j.js","assets/actions-DdSyKubM.js","assets/aws4fetch.esm-BLUAl4pF.js","assets/base64-gMTPUZJI.js","assets/book-BMxh4Vu2.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CZky51Uj.js","assets/core-DLVxU5yj.js","assets/de-0oGfmzTN.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-qvOJhGA3.js","assets/files-CdfAAl3C.js","assets/fr-BIVHexHX.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-DiuEsRLd.js","assets/help-D7mBfJD_.js","assets/http-D7nAFtQx.js","assets/idb-OWIpJU7O.js","assets/index-BrElkLzk.css","assets/index-YKrU8f-u.js","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-C1cAs8tB.js","assets/lesson-C4S8StF7.js","assets/levels-DlkUqTaf.js","assets/local-eTeNYxLc.js","assets/mailbox-D-xLb4zu.js","assets/manifest-BRIPGYy3.js","assets/meshShape-CIY3EL2Q.js","assets/nostr-BQWTvQ75.js","assets/pack-DMf_FYil.js","assets/packageChange-Be729-6H.js","assets/page-D3LwybQn.js","assets/play-DG9Sv4VD.js","assets/post-DIQ6SdV9.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-DrTIWvnW.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/react-hsrUxga6.js","assets/replayFile-CjoQFm8n.js","assets/report-bI7K2EQ0.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CVZButfQ.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelfActions-BEN7yYvd.js","assets/showcase-Dcyx4k9V.js","assets/site-B823XLVz.js","assets/sound-BYXSO4hD.js","assets/standIns-BHeYT5qd.js","assets/store-BIfJd3o_.js","assets/store-CRD4gf7F.js","assets/store-CzJnyz5y.js","assets/store-D7xEfBDz.js","assets/store-DOz5sgSB.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-Cgtdst_x.js","assets/talk-hjLeqB-o.js","assets/three.module-BnHMTVNq.js","assets/thumb-NIa7etSH.js","assets/trystero-DUqYMD3q.js","assets/trystero-DsFzgVPL.js","assets/trystero-dNljToKp.js","assets/webtorrent.min-DeIqevk6.js","assets/worker-BFnKErf7.js","assets/worker-CtrB5Iye.js","assets/worker-DV1DuzPc.js","assets/worker-vKcWsDgC.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
