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
const VERSION = "e9f8bd41af1d";
const FILES = ["assets/Board-hW7sfP2I.js","assets/Branch-Dw2Ul3GV.js","assets/BufferGeometryUtils-xZWDoXM5.js","assets/CommandPanel-D7Ru-Xsb.js","assets/CommandPanel-DNz3msu9.js","assets/Editor-4A6a3RXx.js","assets/FigureLibrary-CjW-CXBD.js","assets/GameScreen-BLF3t8ZK.js","assets/MailLobby-BEy0m906.js","assets/Miniatures-Daf4RYks.js","assets/OpenTables-08fBA84t.js","assets/Packages-DezPH3JH.js","assets/RulesPage-Cc8wkbkN.js","assets/TableWarnings-mOlLXyvt.js","assets/Workshop-CrC7UNM9.js","assets/_virtual_sandbox-worker-Bnrw-Gvu.js","assets/_virtual_soak-worker-CZ_niib9.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/charge-B8JLw33_.js","assets/checksum-B9s_4xdE.js","assets/codec-DOoWeNvh.js","assets/config-Cqo63nnv.js","assets/core-BqZ-DoDb.js","assets/de-uf3d1i6r.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/events-9ce18a08.esm-B_XKA2qH.js","assets/files-CdfAAl3C.js","assets/fr-Dm5DxTxf.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-CrCRM2OY.js","assets/hooks-DDWnGpFx.js","assets/http-Cwv8M0NL.js","assets/index-Bw_0LOX0.js","assets/index-DVxR0HXE.css","assets/jsx-runtime-NZYk81nU.js","assets/layout-B9mpEFlS.js","assets/lesson-4BR5Ah1K.js","assets/levels-DlkUqTaf.js","assets/local-EdSZX2-a.js","assets/mailbox-D-yBNQUj.js","assets/nostr-H4sMdlWe.js","assets/packageChange-Be729-6H.js","assets/page-Di8chvTt.js","assets/post-BedyiN9y.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-BywCXcTA.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-87xqWLg5.js","assets/rift-lanterns-BrpR-PPJ.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CpK43PLW.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelf-28qCWZqS.js","assets/site-B823XLVz.js","assets/sound-BoKCmwOI.js","assets/standIns-OXIxWlRR.js","assets/store-BIx5KRXW.js","assets/store-D168r39F.js","assets/store-DzKutUdS.js","assets/syntax-CEL_Wvla.js","assets/talk-Dt62mVkC.js","assets/three.module-B9uX-pKs.js","assets/trystero-DWViwSsW.js","assets/trystero-U-wyGnZX.js","assets/worker-BNUcxu6K.js","assets/worker-X3JoFKas.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
