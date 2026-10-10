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
const VERSION = "35d8fa7ecec3";
const FILES = ["assets/Board-D1t3oszj.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-Bup7iCYW.js","assets/CommandPanel-CVd0rJOO.js","assets/CommandPanel-DYKIGq_X.js","assets/Editor-Dl3QmYyv.js","assets/EventSeat-D5fjlGYb.js","assets/EventsUI-DPpo79p1.js","assets/FigureLibrary-Ds6tAGgb.js","assets/GameScreen-CHZ0Wm9O.js","assets/MailLobby-9E_Y32CT.js","assets/Miniatures-BARO06BB.js","assets/OpenTables-JjH1Ix9t.js","assets/PlayerCard-DlSYxYO0.js","assets/RankedGame-zHI88BsB.js","assets/RulesPage-D84w25Po.js","assets/StandeeMaker-nOMGrdJx.js","assets/TableWarnings-BNRQQPtp.js","assets/Workshop-BXMIyr9V.js","assets/_virtual_sandbox-worker-Cko_ritB.js","assets/_virtual_soak-worker-DqxLyaif.js","assets/base64-gMTPUZJI.js","assets/book-4N1ujtZy.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CEb1gVoU.js","assets/core-Cl8lDURY.js","assets/de-Dni3ueoT.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/events-9ce18a08.esm-C_8VcJ0N.js","assets/file-BoKMkqUi.js","assets/files-CdfAAl3C.js","assets/fr-C_J1e-WU.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-DSNvwUw9.js","assets/help-sae1cGEd.js","assets/hooks-D60PZCCH.js","assets/http-C5ktxHR7.js","assets/index-BAXVnNFF.js","assets/index-CgE5uvGn.css","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-BEzxNLKz.js","assets/lesson-CGSaql8p.js","assets/levels-DlkUqTaf.js","assets/local-BJDls-zv.js","assets/mailbox-0qS5vEm1.js","assets/nostr-yf64Y7U-.js","assets/packageChange-Be729-6H.js","assets/page-FcSaR8j4.js","assets/play-CP76dN4d.js","assets/post-DdFFIkeA.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-CpUyM0Uz.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-CjGsHuzk.js","assets/rift-lanterns-DLDKmR7R.js","assets/riftLanterns-DJU0ydeI.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CpK43PLW.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelf-C5HpbhJi.js","assets/showcase-5mlaCT0w.js","assets/site-B823XLVz.js","assets/sound-BVczeC0B.js","assets/standIns-BHeYT5qd.js","assets/store-CLjZGgU_.js","assets/store-D-b_6TWr.js","assets/store-DAW5smpC.js","assets/store-j3HuaynK.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-po-u6uyr.js","assets/talk-2K0DFrCi.js","assets/three.module-BnHMTVNq.js","assets/trystero-BFq5-H4G.js","assets/trystero-BrMl_Sv3.js","assets/worker-B8eO-JfR.js","assets/worker-C93mc0GI.js","assets/worker-DBUFWTtz.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
