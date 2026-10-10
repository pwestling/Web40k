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
const VERSION = "9e26e4145ec0";
const FILES = ["assets/Board-Bttv0GKP.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-Byf905ae.js","assets/CommandPanel-CR75IdWu.js","assets/CommandPanel-CvcVK_zM.js","assets/Editor-CJ3of3Fg.js","assets/EventSeat-BNqYcQRA.js","assets/EventsUI-ERtUj42y.js","assets/FigureLibrary-Bb47CGqy.js","assets/GameScreen-D7XFkfpA.js","assets/MailLobby-DKtObJet.js","assets/Miniatures-DqwyZqva.js","assets/OpenTables-yGL-980N.js","assets/PhotoMatch-KFOAUUdD.js","assets/PlayerCard-BjEPD66j.js","assets/RankedGame-BJvBmY_F.js","assets/RulesPage-Dtcjkh_k.js","assets/StandeeMaker-BMjuSYaJ.js","assets/TableWarnings-BdlHqWxY.js","assets/Workshop-BOT4jgzF.js","assets/_virtual_sandbox-worker-Bg0_iaaP.js","assets/_virtual_soak-worker-BMo5DB-m.js","assets/base64-gMTPUZJI.js","assets/book-B6sA8KqI.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CEb1gVoU.js","assets/core-CBc7zgxx.js","assets/de-B0oTrsTF.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-BoKMkqUi.js","assets/files-CdfAAl3C.js","assets/fr-DaYBxtoL.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-DbhSUDgy.js","assets/help-D1Swdtn7.js","assets/http-D9Hx-b0N.js","assets/idb-OWIpJU7O.js","assets/index-Br8FvHRn.js","assets/index-CFndLGrL.css","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-m7AiYM-n.js","assets/lesson-CdgeWCRf.js","assets/levels-DlkUqTaf.js","assets/local-DjrtfMLH.js","assets/mailbox-b9qs55kf.js","assets/meshShape-BWAaUznk.js","assets/nostr-D1AvbNtg.js","assets/packageChange-Be729-6H.js","assets/page-KXVF-Xmj.js","assets/play-CkcAoZkl.js","assets/post-WaWxXoDN.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-B5-beZCg.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-CuIBJ1Tt.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CVZButfQ.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/showcase-Ce_UWj_C.js","assets/site-B823XLVz.js","assets/sound-DxY66mom.js","assets/standIns-BHeYT5qd.js","assets/store-B3GzmIo_.js","assets/store-BFZQJVS4.js","assets/store-DivkXZZA.js","assets/store-FDRys1KH.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-CfG5C_Dz.js","assets/talk-DmcJYK4A.js","assets/three.module-BnHMTVNq.js","assets/thumb-DqJVtmKq.js","assets/trystero-BFq5-H4G.js","assets/trystero-BrMl_Sv3.js","assets/worker-BJU9ElqI.js","assets/worker-CtrB5Iye.js","assets/worker-DV1DuzPc.js","assets/worker-DqV5tZ6b.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
