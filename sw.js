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
const VERSION = "d9f6a04a1f87";
const FILES = ["assets/Board-DuKKIRgL.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-BN343UK8.js","assets/CommandPanel-CKkgJUK_.js","assets/CommandPanel-s_fZQnj5.js","assets/Editor-DhI9OGmy.js","assets/EventSeat-yOnbA-jC.js","assets/EventsUI-wkGFIUYl.js","assets/FigureLibrary-CjiOpt68.js","assets/GameScreen-DVSAGvmL.js","assets/MailLobby-DFKx1gpP.js","assets/Miniatures-DK0ngUj3.js","assets/OpenTables-C9vbFGGB.js","assets/PhotoMatch-Bj_kLRkb.js","assets/PlayerCard-DbafDRVr.js","assets/RankedGame-CQ155-Wz.js","assets/RulesPage-CDSVn9hm.js","assets/StandeeMaker-Di4Mw8Sm.js","assets/TableWarnings-DANfJgFD.js","assets/Workshop-DERZ1A45.js","assets/_virtual_sandbox-worker-rljkywu3.js","assets/_virtual_soak-worker-CwwhBakl.js","assets/base64-gMTPUZJI.js","assets/book-Cd98Q38Z.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CEb1gVoU.js","assets/core-DKyHC_uy.js","assets/de-r8a8isgD.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-BoKMkqUi.js","assets/files-CdfAAl3C.js","assets/fr-Cs5IZSlq.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-B5CbkTv5.js","assets/help-CHKHTJ5u.js","assets/http-Bb-p5UxF.js","assets/idb-OWIpJU7O.js","assets/index-CHiKOhTo.css","assets/index-iRz2nXs0.js","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-BbcAMUmp.js","assets/lesson-CP25mEgb.js","assets/levels-DlkUqTaf.js","assets/local-9uEOP1vv.js","assets/mailbox-Dyl-Gy33.js","assets/meshShape-5rXbK1dX.js","assets/nostr-ZV1jXuUj.js","assets/packageChange-Be729-6H.js","assets/page-DnHCXgUg.js","assets/play-B0jC--yz.js","assets/post-bXEZra9s.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-BkR9HTtU.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-DUWV7riX.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CVZButfQ.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/showcase-asIngdXM.js","assets/site-B823XLVz.js","assets/sound-CwaoN1sq.js","assets/standIns-BHeYT5qd.js","assets/store-BQBbAE4P.js","assets/store-BQfQss-3.js","assets/store-CHFNT_yo.js","assets/store-DvaXp0LL.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-DKewXm4b.js","assets/talk-CX_GNwMr.js","assets/three.module-BnHMTVNq.js","assets/thumb-B_RGvBbg.js","assets/trystero-BFq5-H4G.js","assets/trystero-BrMl_Sv3.js","assets/worker-CiF3TRNE.js","assets/worker-CtrB5Iye.js","assets/worker-DV1DuzPc.js","assets/worker-D_urj2T3.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
