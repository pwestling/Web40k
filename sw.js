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
const VERSION = "43dcb351b1fa";
const FILES = ["assets/Board-BeExVVXu.js","assets/BufferGeometryUtils-xZWDoXM5.js","assets/CommandPanel-DQ0R3cKC.js","assets/CommandPanel-z08Yk60Q.js","assets/CommandPanel-zgEBP4AN.js","assets/Editor-DfGDwIHc.js","assets/FigureLibrary-ge6uF9Uq.js","assets/GameScreen-C-gZBI6N.js","assets/MailLobby-3cclsAyP.js","assets/Miniatures-BUr8gZUN.js","assets/OpenTables-CB1TycHN.js","assets/Packages-fXbdNJ5w.js","assets/RulesPage-QbJRmrQq.js","assets/TableWarnings-GwpSINyt.js","assets/Workshop-BY1DkOSD.js","assets/_virtual_sandbox-worker-BXBJ_6cP.js","assets/_virtual_soak-worker-B1ddXbpH.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/checksum-DJRaK3BZ.js","assets/codec-DOoWeNvh.js","assets/config-CEb1gVoU.js","assets/core-DCNZjvmc.js","assets/de-C50w64Pv.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/events-9ce18a08.esm-BNyZSs2c.js","assets/files-CdfAAl3C.js","assets/fr-D68_tltQ.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-B-vWXiUJ.js","assets/help-eEON2cl5.js","assets/hooks-BcXTUTCV.js","assets/http-B_oxgUkD.js","assets/index-B5J8avPW.css","assets/index-CLvr9roi.js","assets/jsx-runtime-NZYk81nU.js","assets/layout--wDavhyu.js","assets/lesson-KZD4lWmB.js","assets/levels-DlkUqTaf.js","assets/local-BrZ2RkeB.js","assets/mailbox-QeR63yni.js","assets/nostr-f3__Uca_.js","assets/page-BsnSK2Tp.js","assets/post-BJe1Kagp.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-CJP18KMR.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-CYgXnV17.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CpK43PLW.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/setup-Bn6TXpzC.js","assets/shelf-B9FtZTEi.js","assets/showcase-BT2mg1sx.js","assets/site-B823XLVz.js","assets/sound-C7rVYV3J.js","assets/standIns-OXIxWlRR.js","assets/store-DvheekS1.js","assets/store-Ti0Po09x.js","assets/syntax-CEL_Wvla.js","assets/talk-Cz-j9rHn.js","assets/three.module-B9uX-pKs.js","assets/trystero-BFq5-H4G.js","assets/trystero-BrMl_Sv3.js","assets/worker-BawSdSo2.js","assets/worker-CVrGkrwV.js","assets/worker-X3JoFKas.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
