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
const VERSION = "460bda0186b3";
const FILES = ["assets/Board-BaV3Evpc.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-BcKm7Eel.js","assets/CommandPanel-CVd0rJOO.js","assets/CommandPanel-DYKIGq_X.js","assets/Editor-D4zcyT00.js","assets/EventSeat-Ct5SshUh.js","assets/EventsUI-GfcaYxxB.js","assets/FigureLibrary-Cj5xy_4C.js","assets/GameScreen-BCcW9IVc.js","assets/MailLobby-sin-Rqlb.js","assets/Miniatures-DBenOOhR.js","assets/OpenTables-CHDZ-BNl.js","assets/PhotoMatch-ntl0aCSI.js","assets/PlayerCard-B4SMPt25.js","assets/RankedGame-DPT4KKly.js","assets/RulesPage-JVpLxyGo.js","assets/StandeeMaker-DNr8-bG8.js","assets/TableWarnings-DqwqFx1o.js","assets/Workshop-BxGZdO91.js","assets/_virtual_sandbox-worker-Cko_ritB.js","assets/_virtual_soak-worker-CZPL8BAv.js","assets/base64-gMTPUZJI.js","assets/book-BB2ZvZvn.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CEb1gVoU.js","assets/core-DSTk-1Jp.js","assets/de-Be3qWb-c.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-BoKMkqUi.js","assets/files-CdfAAl3C.js","assets/fr-DuwDlnlE.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-CJVxu9jO.js","assets/help-hbqf5Ef9.js","assets/hooks-CBZdhPGB.js","assets/http-m_FSplKu.js","assets/idb-OWIpJU7O.js","assets/index-CXQ3yOmK.css","assets/index-Dve2_TlN.js","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-CX6SOPdQ.js","assets/lesson-BPLPbQJ4.js","assets/levels-DlkUqTaf.js","assets/local-CbD9TX7n.js","assets/mailbox-DT3TT9XG.js","assets/meshShape-BSMScutp.js","assets/nostr-CQscEegz.js","assets/packageChange-Be729-6H.js","assets/page-D4i6huw2.js","assets/play-CBQETs6m.js","assets/post-XGvlEBig.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-BfYkCdeB.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-C5eXbfVx.js","assets/rift-lanterns-DLDKmR7R.js","assets/riftLanterns-hPYX5isi.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CpK43PLW.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/showcase-DZTphftD.js","assets/site-B823XLVz.js","assets/sound-B5dqe_Ay.js","assets/standIns-BHeYT5qd.js","assets/store-BTJJe3ZN.js","assets/store-Cls7gS_5.js","assets/store-DggXuN9d.js","assets/store-DmPLwmDY.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-D2HXlFcx.js","assets/talk-xZFW6Fj8.js","assets/three.module-BnHMTVNq.js","assets/thumb-BAjwwe5Z.js","assets/trystero-BFq5-H4G.js","assets/trystero-BrMl_Sv3.js","assets/worker-B8eO-JfR.js","assets/worker-C93mc0GI.js","assets/worker-DBUFWTtz.js","assets/worker-DV1DuzPc.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
