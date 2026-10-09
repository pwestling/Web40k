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
const VERSION = "1be6c7712740";
const FILES = ["assets/Board-BXzGDp9I.js","assets/BufferGeometryUtils-xZWDoXM5.js","assets/CommandPanel-CQMu1OhW.js","assets/CommandPanel-CwbTlslt.js","assets/Editor-JQ6rsjHV.js","assets/FigureLibrary-DvMFJktg.js","assets/GameScreen-ButyxzZd.js","assets/MailLobby-DjZXXynn.js","assets/Miniatures-BEDSJCv1.js","assets/OpenTables-1YxmnuAF.js","assets/Packages-TVac1q3-.js","assets/RulesPage-Cx4f_Fds.js","assets/TableWarnings-vkb4nB9Y.js","assets/Workshop-B_IlvAuU.js","assets/_virtual_sandbox-worker-m7c2qz14.js","assets/_virtual_soak-worker-CU_Ktyhg.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/checksum-DJRaK3BZ.js","assets/codec-DOoWeNvh.js","assets/config-Cqo63nnv.js","assets/core-BPQWrRpF.js","assets/de-5OZfmDTe.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/events-9ce18a08.esm-Dz3KJRUU.js","assets/files-CdfAAl3C.js","assets/fr-DHr8Y5Zw.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-DGVcL4ja.js","assets/help-eEON2cl5.js","assets/hooks-U2OOwtsw.js","assets/http-DEDD1N3o.js","assets/index-B8IdIMH4.css","assets/index-DwvPKN8a.js","assets/jsx-runtime-NZYk81nU.js","assets/layout-QiP7YOOs.js","assets/lesson-BtdH_VEd.js","assets/levels-DlkUqTaf.js","assets/local-IaNjXe1p.js","assets/mailbox-CmGcW1O9.js","assets/nostr-D26f41gB.js","assets/page-DUxJ5RTa.js","assets/post-BWCAx3JV.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-H13iWzw9.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-D0Bou_vF.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CpK43PLW.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/setup-0319Y-Tb.js","assets/shelf-Rp2-NiE7.js","assets/showcase-BT2mg1sx.js","assets/site-B823XLVz.js","assets/sound-C7rVYV3J.js","assets/standIns-OXIxWlRR.js","assets/store-Du9ChZBc.js","assets/store-kg6_2LIE.js","assets/syntax-CEL_Wvla.js","assets/talk-BWghU9lP.js","assets/three.module-B9uX-pKs.js","assets/trystero-DWViwSsW.js","assets/trystero-U-wyGnZX.js","assets/worker-BbujukK9.js","assets/worker-X3JoFKas.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
