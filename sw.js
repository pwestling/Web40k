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
const VERSION = "ec7c2c4a25da";
const FILES = ["assets/Board-BWII3uIL.js","assets/BufferGeometryUtils-xZWDoXM5.js","assets/CommandPanel-4IjNDClQ.js","assets/CommandPanel-C2hCd_Ex.js","assets/CommandPanel-Q5COWvdD.js","assets/Editor-BykW2eZt.js","assets/EventSeat-3Wk7P6zx.js","assets/EventsUI-BSKVxS0Z.js","assets/FigureLibrary-BCgMA4MW.js","assets/GameScreen-CvSJw5gI.js","assets/MailLobby-DN-mvMPv.js","assets/Miniatures-jcHTFVwB.js","assets/OpenTables-M0Tm6wrH.js","assets/Packages-dSXjyl2m.js","assets/PlayerCard-BOhlBpc7.js","assets/RankedGame-CIqtkMmi.js","assets/RulesPage-BRxYqimM.js","assets/StandeeMaker-D5avKl4L.js","assets/TableWarnings-Ctubf5n5.js","assets/Workshop-CAg09Km_.js","assets/_virtual_sandbox-worker-Dct3xvTj.js","assets/_virtual_soak-worker-D_B1XrA8.js","assets/base64-gMTPUZJI.js","assets/book-DGvmGtsY.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CEb1gVoU.js","assets/core-Dq6nPv8n.js","assets/de-BiceOFAa.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/events-9ce18a08.esm-BE7DL-zQ.js","assets/files-CdfAAl3C.js","assets/fr-S6--vpK9.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-CFyhKxRQ.js","assets/help-sQVGlm6R.js","assets/hooks-DtHINFzN.js","assets/http-BE0Tp3QL.js","assets/index-CRgCrVun.js","assets/index-D9sUakXm.css","assets/jsx-runtime-NZYk81nU.js","assets/layout-CidUhAsq.js","assets/lesson-Co55xEkp.js","assets/levels-DlkUqTaf.js","assets/local-DZy4JF4P.js","assets/mailbox-BHgVMXX9.js","assets/nostr-CV_Pa1xn.js","assets/packageChange-Be729-6H.js","assets/page-C3WOsZ9t.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-C-R8IdjQ.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-BJhuaMMe.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CpK43PLW.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/setup-7cTmq5M7.js","assets/shelf-BnpJbS0V.js","assets/showcase-D3nFoFAv.js","assets/site-B823XLVz.js","assets/sound-VPZKiCmr.js","assets/standIns-OXIxWlRR.js","assets/store-C4_FI0nJ.js","assets/store-CwSPzjwF.js","assets/store-DMvc0lrg.js","assets/store-W8AzfnYb.js","assets/store-YF3_9Acv.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-CC-La0Br.js","assets/talk-lcLoBZXr.js","assets/three.module-B9uX-pKs.js","assets/trystero-BFq5-H4G.js","assets/trystero-BrMl_Sv3.js","assets/worker-Do0AGqGh.js","assets/worker-DuUTqMsS.js","assets/worker-zPimb7RQ.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
