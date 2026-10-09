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
const VERSION = "a6bdba8c67a6";
const FILES = ["assets/Board-CfuiBEZ-.js","assets/BufferGeometryUtils-xZWDoXM5.js","assets/CommandPanel-CvitGZrJ.js","assets/CommandPanel-Cyi2f1WU.js","assets/Editor-CuTycscl.js","assets/FigureLibrary-CnS2Y3er.js","assets/GameScreen-yASuFY7G.js","assets/MailLobby-Buud4YEL.js","assets/Miniatures-BA2hcBUv.js","assets/OpenTables-Co4CQXkJ.js","assets/Packages-DUtODq4B.js","assets/RulesPage-Cv5TgsBk.js","assets/TableWarnings-DB7rbnuU.js","assets/Workshop-CTvg4Soi.js","assets/_virtual_sandbox-worker-DCG289P5.js","assets/_virtual_soak-worker-XrdrTWWU.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/charge-DwwCJ-0t.js","assets/checksum-B9s_4xdE.js","assets/codec-DOoWeNvh.js","assets/config-Cqo63nnv.js","assets/core-B5f4hNyp.js","assets/de-Cd0zJc7O.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/events-9ce18a08.esm-BoqKFdzr.js","assets/files-CdfAAl3C.js","assets/fr-D0vJRIIX.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-BzEv9ReU.js","assets/hooks-D6dOo8v7.js","assets/http-CC68GklI.js","assets/index-CE6xdeKh.js","assets/index-DI_D6de8.css","assets/jsx-runtime-NZYk81nU.js","assets/layout-GmdgGaPZ.js","assets/lesson-Ci9zvNTt.js","assets/levels-DlkUqTaf.js","assets/local-BNJdLgUn.js","assets/mailbox-BqXLMD-v.js","assets/nostr-DDiJYGP0.js","assets/page-CD_4jbmJ.js","assets/post-CT4080Hf.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-Dcxh-BcM.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-Cv85Hqt7.js","assets/rift-lanterns-BrpR-PPJ.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CpK43PLW.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelf-CjidqlaL.js","assets/site-B823XLVz.js","assets/sound-BoKCmwOI.js","assets/standIns-OXIxWlRR.js","assets/store-0iibVn0h.js","assets/store-BuX68bfg.js","assets/syntax-CEL_Wvla.js","assets/talk-luslpPRg.js","assets/three.module-B9uX-pKs.js","assets/trystero-DWViwSsW.js","assets/trystero-U-wyGnZX.js","assets/worker-X3JoFKas.js","assets/worker-d4rQ8lkD.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
