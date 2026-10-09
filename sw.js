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
const VERSION = "1a19f0de0f18";
const FILES = ["assets/Board-C16T_YHA.js","assets/BufferGeometryUtils-xZWDoXM5.js","assets/CommandPanel-BV7uIQ2n.js","assets/CommandPanel-Cz6V7BvL.js","assets/Editor-W_k11ZSA.js","assets/FigureLibrary-ChmIr9_S.js","assets/GameScreen-DHHNqpN9.js","assets/MailLobby-CJW3WzP1.js","assets/Miniatures-Cpe3JRB4.js","assets/OpenTables-wwpb8gRF.js","assets/Packages-DuEiPGMK.js","assets/RulesPage-DReM-55b.js","assets/TableWarnings-BUvvEBM1.js","assets/Workshop-B5WKLKHN.js","assets/_virtual_sandbox-worker-DderZx-U.js","assets/_virtual_soak-worker-DEg4DoaA.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/checksum-B9s_4xdE.js","assets/codec-DOoWeNvh.js","assets/config-Cqo63nnv.js","assets/core-Dylkk3cm.js","assets/de-DCTFGX5H.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/events-9ce18a08.esm-C9RFM-g9.js","assets/files-CdfAAl3C.js","assets/fr-BQ2ep4ZZ.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-TsF2h2C0.js","assets/hooks-xMir0OaG.js","assets/http-CDnU4cDZ.js","assets/index-mSZjBUSM.js","assets/index-mkeOANmB.css","assets/jsx-runtime-NZYk81nU.js","assets/layout-CsohTb9S.js","assets/lesson-K8XA3pFW.js","assets/levels-DlkUqTaf.js","assets/local-CRM0H4pn.js","assets/mailbox-BLtKJEfR.js","assets/nostr-4zOi9Zm2.js","assets/page-7qXPG6EC.js","assets/post-CO_P86pB.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-BbQtr14B.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-B-ybn4-4.js","assets/rift-lanterns-Caf6oLxO.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CpK43PLW.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelf-DO9QUB5t.js","assets/site-B823XLVz.js","assets/sound-BoKCmwOI.js","assets/standIns-OXIxWlRR.js","assets/store-Bfo_P5ed.js","assets/store-DDSLcDN4.js","assets/syntax-CEL_Wvla.js","assets/talk-BUjRW4_H.js","assets/three.module-B9uX-pKs.js","assets/trystero-DWViwSsW.js","assets/trystero-U-wyGnZX.js","assets/worker-X3JoFKas.js","assets/worker-YwtprebK.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
