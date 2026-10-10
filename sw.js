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
const VERSION = "2a95fad9a8f1";
const FILES = ["assets/Board-DYaDQozj.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-BaFAun-R.js","assets/CommandPanel-CmtsyjSL.js","assets/CommandPanel-CzhOeqKR.js","assets/Editor-Dj-pRzBy.js","assets/EventSeat-CzwmPONg.js","assets/EventsUI-CvzFa2RB.js","assets/FigureLibrary-2Q7ZXzlB.js","assets/GameScreen-BqtAINT_.js","assets/MailLobby-CZyaJxnu.js","assets/Miniatures-BlB4_eVe.js","assets/OpenTables-DA0r5ugM.js","assets/PhotoMatch-CA6fz6Z_.js","assets/PlayerCard-Dn7_29f8.js","assets/RankedGame-D-wHO4ND.js","assets/RulesPage-BlygqV32.js","assets/StandeeMaker-Do3E3Gg7.js","assets/TableWarnings-l4eL_pJk.js","assets/Workshop-Bju3eNvK.js","assets/_virtual_sandbox-worker-Cvl9Ar9B.js","assets/_virtual_soak-worker-BMLwNYKl.js","assets/base64-gMTPUZJI.js","assets/book-Bha4NALw.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CEb1gVoU.js","assets/core-LHBRUtB0.js","assets/de-qI5g-IvF.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-BoKMkqUi.js","assets/files-CdfAAl3C.js","assets/fr-DhybSeFd.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-CvplFBh8.js","assets/help-VIGRRhf2.js","assets/http-Bway-HZh.js","assets/idb-OWIpJU7O.js","assets/index-B1vLzUfL.js","assets/index-EUhTXr_o.css","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-BOLhLJof.js","assets/lesson-n8QViUNJ.js","assets/levels-DlkUqTaf.js","assets/local--wuYsSOA.js","assets/mailbox-Gi0H_Nau.js","assets/meshShape-BXGJ1V2D.js","assets/nostr-BTwD6s7k.js","assets/packageChange-Be729-6H.js","assets/page-BeuPJu7G.js","assets/play-tSQI3i4x.js","assets/post-Sw1sKvqu.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-JdkUQ1LJ.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-sxo5KQ7Z.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-3qflJCEN.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/showcase-922O-v6N.js","assets/site-B823XLVz.js","assets/sound-GEcf7sLa.js","assets/standIns-BHeYT5qd.js","assets/store-BCJW7YTt.js","assets/store-Cbge6nEp.js","assets/store-CfGxMHgI.js","assets/store-DhONcyue.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-C9qvozyA.js","assets/talk-DIMjKoq6.js","assets/three.module-BnHMTVNq.js","assets/thumb-F1VwIIkT.js","assets/trystero-BFq5-H4G.js","assets/trystero-BrMl_Sv3.js","assets/worker-CtrB5Iye.js","assets/worker-DKJJdHoh.js","assets/worker-DNQlxEVU.js","assets/worker-DV1DuzPc.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
