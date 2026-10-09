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
const VERSION = "2df340423bb2";
const FILES = ["assets/Board-BP8mwcD0.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-BslX1Pur.js","assets/CommandPanel-Cc4-I5Dh.js","assets/CommandPanel-WHmQxZdm.js","assets/Editor-Cuass7ss.js","assets/EventSeat-C4zTSkJe.js","assets/EventsUI-C-O4ua62.js","assets/FigureLibrary-BsEYqRXK.js","assets/GameScreen-D9Bwsu8B.js","assets/MailLobby-BNeGp1Tr.js","assets/Miniatures-DG9_ACv6.js","assets/OpenTables-Cfc7g6o0.js","assets/Packages-UVNgxb_D.js","assets/PlayerCard-C2eCvvt9.js","assets/RankedGame-C7n1z9ci.js","assets/RulesPage-D9EMzolC.js","assets/StandeeMaker-Cl8da14q.js","assets/TableWarnings-CvHVhXWR.js","assets/Workshop-NQiYiO5y.js","assets/_virtual_sandbox-worker-ChCEA-Zh.js","assets/_virtual_soak-worker-DCCuiKde.js","assets/base64-gMTPUZJI.js","assets/book-DrfdLdND.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CEb1gVoU.js","assets/core-B1itL8pY.js","assets/de-DLDAgBM4.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/events-9ce18a08.esm-CNuoPqpC.js","assets/files-CdfAAl3C.js","assets/fr-BTWtFRhI.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-D86fAht3.js","assets/help-CXLkif_B.js","assets/hooks-DiFonSt_.js","assets/http-Cv1rvCsk.js","assets/index-BWQc-so8.css","assets/index-CcS_XYTO.js","assets/jsx-runtime-NZYk81nU.js","assets/layout-B4xmZOMx.js","assets/lesson-Cj2If6ms.js","assets/levels-DlkUqTaf.js","assets/local-CPekB4OS.js","assets/mailbox-lobcT9tT.js","assets/nostr-O2cuAIW-.js","assets/packageChange-Be729-6H.js","assets/page-CTJHLwCP.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-uh-ajYr2.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-Cc5B6jqN.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CpK43PLW.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/setup-hrv1dNy3.js","assets/shelf-BdtdeRSg.js","assets/showcase-CCBGh-OV.js","assets/site-B823XLVz.js","assets/sound-O8WuvKsJ.js","assets/standIns-BHeYT5qd.js","assets/store-B-f61gkX.js","assets/store-B2UvCu0U.js","assets/store-Cae-5u9a.js","assets/store-CfLPkIjX.js","assets/store-DGaIl180.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-DehnpX8s.js","assets/talk-Df8snGlH.js","assets/three.module-BnHMTVNq.js","assets/trystero-BFq5-H4G.js","assets/trystero-BrMl_Sv3.js","assets/worker-3HR3qJt_.js","assets/worker-DTZxkTv2.js","assets/worker-DuUTqMsS.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
