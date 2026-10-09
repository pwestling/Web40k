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
const VERSION = "792ad4a9f3a1";
const FILES = ["assets/Board-ByUUKzMo.js","assets/BufferGeometryUtils-xZWDoXM5.js","assets/CommandPanel-C8LLtlmf.js","assets/CommandPanel-DEEciY-O.js","assets/CommandPanel-dLBBFE_H.js","assets/Editor-B-huZnk9.js","assets/FigureLibrary-BOLsOZwJ.js","assets/GameScreen-BWmIePtP.js","assets/MailLobby-DawxmoxM.js","assets/Miniatures-gAz3AJgL.js","assets/OpenTables-D09mZwai.js","assets/Packages-ZPFU7Y6X.js","assets/PlayerCard-DEoxpWjG.js","assets/RulesPage-DGhAqoGZ.js","assets/TableWarnings-vYZKlPhI.js","assets/Workshop-BiM2T1tj.js","assets/_virtual_sandbox-worker--eYuf8NK.js","assets/_virtual_soak-worker-_0kADziW.js","assets/book-qHBLD2CL.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/checksum-DJRaK3BZ.js","assets/codec-DOoWeNvh.js","assets/config-CEb1gVoU.js","assets/core-B9_8l5d3.js","assets/de-CrU_3Utl.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/events-9ce18a08.esm-BEROHiq4.js","assets/files-CdfAAl3C.js","assets/fr-CUBVGg1C.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-Dd0u3h3P.js","assets/help-eEON2cl5.js","assets/hooks-B6Ozt8IP.js","assets/http-itbBoAlv.js","assets/index-Bfkx1j9A.css","assets/index-Dhr1VXox.js","assets/jsx-runtime-NZYk81nU.js","assets/layout-duT0QkzO.js","assets/lesson-B3mf3hIb.js","assets/levels-DlkUqTaf.js","assets/local-DZKNLiQV.js","assets/mailbox-B1AUP-0B.js","assets/nostr-DoewqrNy.js","assets/page-CKIHUog_.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-oSJRFExw.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-DPb5HP8J.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CpK43PLW.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/setup-DLs0DNaB.js","assets/shelf-kyhmbKiU.js","assets/showcase-BT2mg1sx.js","assets/site-B823XLVz.js","assets/sound-C7rVYV3J.js","assets/standIns-OXIxWlRR.js","assets/store-B7xR8lFp.js","assets/store-CpBtAfWZ.js","assets/store-DdKNpkCo.js","assets/store-DqlacuK_.js","assets/store-SdnW3fR4.js","assets/syntax-CEL_Wvla.js","assets/talk-DvwtxEBZ.js","assets/three.module-B9uX-pKs.js","assets/trystero-BFq5-H4G.js","assets/trystero-BrMl_Sv3.js","assets/worker-DyPoytwH.js","assets/worker-X3JoFKas.js","assets/worker-Xrt9z-BK.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
