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
const VERSION = "063fc8bd4b0f";
const FILES = ["assets/Board-BKO_U4QD.js","assets/BufferGeometryUtils-xZWDoXM5.js","assets/CommandPanel-BVRfI0C3.js","assets/CommandPanel-DTzD8Z55.js","assets/Editor-CYx3NY_t.js","assets/FigureLibrary-BViPBaVy.js","assets/GameScreen-DGq3QWc8.js","assets/MailLobby-BgUSW43j.js","assets/Miniatures-B_deY1y7.js","assets/OpenTables-CEZPfcNf.js","assets/Packages-QuGIQKwv.js","assets/RulesPage-BeIx9HdO.js","assets/TableWarnings-CAheh0Tx.js","assets/Workshop-DXfQLOnK.js","assets/_virtual_sandbox-worker-BrE2GPlj.js","assets/_virtual_soak-worker-BoKe_Ypd.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/charge-mAkN2pjA.js","assets/checksum-B9s_4xdE.js","assets/codec-DOoWeNvh.js","assets/config-Cqo63nnv.js","assets/core-BfDdLgSf.js","assets/de-DBzgI9yr.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/events-9ce18a08.esm-Ddv2h3bZ.js","assets/files-CdfAAl3C.js","assets/fr-6ayRHr7k.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-DhC4Aq-t.js","assets/hooks-C5-X1ube.js","assets/http-DC19-rew.js","assets/index-DI_D6de8.css","assets/index-DxC0MMKU.js","assets/jsx-runtime-NZYk81nU.js","assets/layout-DMGAPcWU.js","assets/lesson-Sq8TQeyu.js","assets/levels-DlkUqTaf.js","assets/local-DpQmpITO.js","assets/mailbox-BKrFMtev.js","assets/nostr-ByD_XuFY.js","assets/page-B4RWYCI0.js","assets/post-DwsCia0E.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-B5iiseMj.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-BDUe8op5.js","assets/rift-lanterns-Caf6oLxO.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CpK43PLW.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelf-DDOWcx5Y.js","assets/site-B823XLVz.js","assets/sound-BoKCmwOI.js","assets/standIns-OXIxWlRR.js","assets/store--MT0rgLW.js","assets/store-DEywHZ68.js","assets/syntax-CEL_Wvla.js","assets/talk-MdJTQx0C.js","assets/three.module-B9uX-pKs.js","assets/trystero-DWViwSsW.js","assets/trystero-U-wyGnZX.js","assets/worker-DOg8fqoZ.js","assets/worker-X3JoFKas.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
