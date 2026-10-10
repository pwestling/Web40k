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
const VERSION = "2e302c030c45";
const FILES = ["assets/Board-CC9TMkqO.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-D2BXXcT9.js","assets/CommandPanel-DqJ8tL6m.js","assets/CommandPanel-k_LkVxao.js","assets/Editor-Bg_ERV6H.js","assets/EventSeat-BdDTxF0i.js","assets/EventsUI-D6nqzzsg.js","assets/FigureLibrary-DAJjxxO4.js","assets/GameScreen-BCd6ef7w.js","assets/MailLobby-DTr-uOaw.js","assets/Miniatures-DAaL78uG.js","assets/OpenTables-DpfwjAI0.js","assets/PhotoMatch-CvNulauE.js","assets/PlayerCard-_orHU7fh.js","assets/RankedGame-DEWPlgi_.js","assets/RulesPage-90QRYOgz.js","assets/StandeeMaker-BnerdtGu.js","assets/TableWarnings-9sI2HUru.js","assets/Workshop-UFlbFuir.js","assets/_virtual_sandbox-worker-Bn1kowG9.js","assets/_virtual_soak-worker-DcUtnOqm.js","assets/base64-gMTPUZJI.js","assets/book-DaIb3mk1.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CEb1gVoU.js","assets/core-CsIQk2RX.js","assets/de-DmAacxEJ.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-BoKMkqUi.js","assets/files-CdfAAl3C.js","assets/fr-D3_eirlf.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-rjyA0umg.js","assets/help-_19XUAS1.js","assets/hooks-BZXrpnoI.js","assets/http-gIvtO7Kj.js","assets/idb-OWIpJU7O.js","assets/index-EUhTXr_o.css","assets/index-Yjl_gvTz.js","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-Cyp-Elij.js","assets/lesson-DhdsM20D.js","assets/levels-DlkUqTaf.js","assets/local-CWutP7SW.js","assets/mailbox-CPRMCsxb.js","assets/meshShape-CkRcMmMj.js","assets/nostr-BpARUXym.js","assets/packageChange-Be729-6H.js","assets/page-D2VHkHSX.js","assets/play-Dn0Ie-NS.js","assets/post-e4iUVA84.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-BAT7Nz-o.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-DSYUfleC.js","assets/rift-lanterns-DLDKmR7R.js","assets/riftLanterns-DrZ-1LXO.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-3qflJCEN.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/showcase-cIOyadez.js","assets/site-B823XLVz.js","assets/sound-BO0CmCm0.js","assets/standIns-BHeYT5qd.js","assets/store-BO-rVgyT.js","assets/store-BWzoBOd2.js","assets/store-Cb33lhG6.js","assets/store-DnSqm-B2.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-Dt9a6TqW.js","assets/talk-CInzHRcm.js","assets/three.module-BnHMTVNq.js","assets/thumb-C2vHeNIr.js","assets/trystero-BFq5-H4G.js","assets/trystero-BrMl_Sv3.js","assets/worker-BuMnC3DF.js","assets/worker-C93mc0GI.js","assets/worker-D7vhIpsU.js","assets/worker-DV1DuzPc.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
