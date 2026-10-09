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
const VERSION = "4a679a48fcc7";
const FILES = ["assets/Board-VjT3Q-Hx.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-BslX1Pur.js","assets/CommandPanel-Cc4-I5Dh.js","assets/CommandPanel-DzwIW1zx.js","assets/Editor-BvDAG6Q0.js","assets/EventSeat-DKH-MSYG.js","assets/EventsUI-B49nfEwp.js","assets/FigureLibrary-BEOhUzS_.js","assets/GameScreen-Cn0cQRiJ.js","assets/MailLobby-CU4cQaFD.js","assets/Miniatures-dhb9-mUc.js","assets/OpenTables-DLiCxTDp.js","assets/PlayerCard-DNMgfprw.js","assets/RankedGame-CfOMvec3.js","assets/RulesPage-BCbTDv-r.js","assets/StandeeMaker-AnVuJ-PW.js","assets/TableWarnings-Db9wWEfZ.js","assets/Workshop-Bb48FCWJ.js","assets/_virtual_sandbox-worker-ChCEA-Zh.js","assets/_virtual_soak-worker-DCCuiKde.js","assets/base64-gMTPUZJI.js","assets/book-BB8400S3.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CEb1gVoU.js","assets/core-BArpOCPo.js","assets/de-Y_l--goW.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/events-9ce18a08.esm-ZLHF0Bo5.js","assets/files-CdfAAl3C.js","assets/fr-DuWm1dUn.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-CRdkBuGe.js","assets/help-H1skymmk.js","assets/hooks-d_QKPKnj.js","assets/http-B0CiDK5-.js","assets/index-BWQc-so8.css","assets/index-CzQJU8sK.js","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-YgMc7YPx.js","assets/lesson-B9TP-hKm.js","assets/levels-DlkUqTaf.js","assets/local-CsKk0aJd.js","assets/mailbox-PIS-1A9C.js","assets/nostr-B8wHTtAp.js","assets/packageChange-Be729-6H.js","assets/page-C6H25bSD.js","assets/play-rv0fyAFS.js","assets/post-Cn8wABFV.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-Db3T7K0n.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-D7tb0e2P.js","assets/rift-lanterns-DLDKmR7R.js","assets/riftLanterns-C8NViHZS.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CpK43PLW.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelf-Dg7pxAcA.js","assets/showcase-Cc3Oplsg.js","assets/site-B823XLVz.js","assets/sound-ZPV72Bv9.js","assets/standIns-BHeYT5qd.js","assets/store-BQo8BSzL.js","assets/store-BbZ8Kc54.js","assets/store-CnjAwCe3.js","assets/store-DCSG8ccR.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-GJHaYbVU.js","assets/talk-CFGHjNGs.js","assets/three.module-BnHMTVNq.js","assets/trystero-BFq5-H4G.js","assets/trystero-BrMl_Sv3.js","assets/worker-3HR3qJt_.js","assets/worker-DTZxkTv2.js","assets/worker-DuUTqMsS.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
