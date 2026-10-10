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
const VERSION = "caeea80c920a";
const FILES = ["assets/Board-B-sIF1NL.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-BGKPQQ4M.js","assets/CommandPanel-DHCDQ1Dw.js","assets/CommandPanel-DIrj3F0i.js","assets/Editor-D063pWjn.js","assets/EventSeat-BGQSBGWj.js","assets/EventsUI-DvOvnZXA.js","assets/FigureLibrary-9XjbOmtw.js","assets/GameScreen-BmM2J2ln.js","assets/MailLobby-DJhdBUNd.js","assets/Miniatures-CH13JFjE.js","assets/OpenTables-BNybDrTq.js","assets/PhotoMatch-B4Jk1XZe.js","assets/PlayerCard-DhEJhnZC.js","assets/RankedGame-_FN1YWZb.js","assets/RulesPage-RNK1FjHw.js","assets/StandeeMaker-B8Igk9IG.js","assets/TableWarnings-C4mnQnlK.js","assets/Workshop-CjoL1P8L.js","assets/_virtual_sandbox-worker-BC2NVjiQ.js","assets/_virtual_soak-worker-Cm57qdY9.js","assets/actions-CLj9mVX5.js","assets/aws4fetch.esm-BLUAl4pF.js","assets/base64-gMTPUZJI.js","assets/book-wYKrbyLs.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-Kg6xkhHB.js","assets/core-C2tgu0El.js","assets/de-B319y6mW.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-qvOJhGA3.js","assets/files-CdfAAl3C.js","assets/fr-DBGIF9Bj.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-Qag6C9xL.js","assets/help-BP3D8Qck.js","assets/http-mB4bYlgF.js","assets/idb-OWIpJU7O.js","assets/index-C4rxERlD.css","assets/index-pfAFXXMQ.js","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-vn0EIkQX.js","assets/lesson-BOGce_X_.js","assets/levels-DlkUqTaf.js","assets/local-x5UXwsER.js","assets/mailbox-Cn8hjD9Y.js","assets/manifest-bE-32xpp.js","assets/meshShape-BwzGE4p5.js","assets/nostr-Tqx38_S9.js","assets/pack-CO7O-66K.js","assets/packageChange-Be729-6H.js","assets/page-0OcxNacE.js","assets/play-GcjkaMAv.js","assets/post-BhziMuVs.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-DwOPT8HM.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/react-hsrUxga6.js","assets/replayFile-CaQ6SEJd.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CVZButfQ.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelfActions-C9Tgw0hz.js","assets/showcase-Dcyx4k9V.js","assets/site-B823XLVz.js","assets/sound-D-PZn1qw.js","assets/standIns-BHeYT5qd.js","assets/store-4Tg0U_xM.js","assets/store-C6zsPMI8.js","assets/store-CAzGLe5a.js","assets/store-Cuyu9Ih_.js","assets/store-DHwNY2u0.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-C5WA32bv.js","assets/talk-CM3eujyy.js","assets/three.module-BnHMTVNq.js","assets/thumb-B4GwmP4B.js","assets/trystero-B6gLvrIU.js","assets/trystero-CnTvyFix.js","assets/webtorrent.min-DeIqevk6.js","assets/worker-BfQ1Qgov.js","assets/worker-Bw0aCMCJ.js","assets/worker-CtrB5Iye.js","assets/worker-DV1DuzPc.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
