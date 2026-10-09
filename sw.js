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
const VERSION = "9f5e52826b86";
const FILES = ["assets/Board-DiNo2tcp.js","assets/BufferGeometryUtils-xZWDoXM5.js","assets/CommandPanel-C8LLtlmf.js","assets/CommandPanel-DEEciY-O.js","assets/CommandPanel-DWCHXFPj.js","assets/Editor-CcmDt2Cm.js","assets/FigureLibrary-D3A38aO3.js","assets/GameScreen-9AsiLpMp.js","assets/MailLobby-CJbYq7dn.js","assets/Miniatures-7GjLxTrT.js","assets/OpenTables-Mj3u7fIS.js","assets/Packages-D7E3eNMl.js","assets/PlayerCard-BFOGCmH-.js","assets/RulesPage-l9KZb-qN.js","assets/TableWarnings-CIs0SZzR.js","assets/Workshop-B2zBXSQ5.js","assets/_virtual_sandbox-worker--eYuf8NK.js","assets/_virtual_soak-worker-_0kADziW.js","assets/book-BIGV-OGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/checksum-DJRaK3BZ.js","assets/codec-DOoWeNvh.js","assets/config-CEb1gVoU.js","assets/core-BOCOffn0.js","assets/de-Cknnht1x.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/events-9ce18a08.esm-BqzfpyWT.js","assets/files-CdfAAl3C.js","assets/fr-Hkheukqu.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-ByhJhtBF.js","assets/help-eEON2cl5.js","assets/hooks-C7i3Qn_o.js","assets/http-CVVdqsxL.js","assets/index-Bfkx1j9A.css","assets/index-DIQ220YR.js","assets/jsx-runtime-NZYk81nU.js","assets/layout-DVUKSGOD.js","assets/lesson-Ch3vfi4G.js","assets/levels-DlkUqTaf.js","assets/local-QqiFe1EE.js","assets/mailbox-D0XKBNOS.js","assets/nostr-GRQvmpFh.js","assets/page-DRR9A_zK.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-rc_XN1rB.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-PyFhbArZ.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CpK43PLW.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/setup-DWCBBJPM.js","assets/shelf-V2Rw0lsB.js","assets/showcase-BT2mg1sx.js","assets/site-B823XLVz.js","assets/sound-C7rVYV3J.js","assets/standIns-OXIxWlRR.js","assets/store-BJwmlUNf.js","assets/store-COLwjP8F.js","assets/store-D0jwn0A3.js","assets/store-D4fd-8kR.js","assets/store-D7lcIUxo.js","assets/syntax-CEL_Wvla.js","assets/talk-BIMTgVK5.js","assets/three.module-B9uX-pKs.js","assets/trystero-BFq5-H4G.js","assets/trystero-BrMl_Sv3.js","assets/worker-DyPoytwH.js","assets/worker-X3JoFKas.js","assets/worker-Xrt9z-BK.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
