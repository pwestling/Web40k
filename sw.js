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
const VERSION = "9252c4101155";
const FILES = ["assets/Board-DuvPiiyv.js","assets/Branch-BDxXp9RP.js","assets/BufferGeometryUtils-xZWDoXM5.js","assets/CommandPanel-FI7wBFQ8.js","assets/CommandPanel-dzrjRPSe.js","assets/Editor-BQ4DkIdr.js","assets/FigureLibrary-yM0PD3tB.js","assets/GameScreen-nJm38zvX.js","assets/MailLobby-Ux2npuDe.js","assets/Miniatures-BxMAuUf3.js","assets/OpenTables-D5UDygdh.js","assets/Packages-CGIY_7M1.js","assets/RulesPage-Di-zkrQd.js","assets/TableWarnings-DEPb3yAL.js","assets/Workshop-KvqIHcxI.js","assets/_virtual_sandbox-worker-B3zb6TaP.js","assets/_virtual_soak-worker-cNaVE-yz.js","assets/base64-gMTPUZJI.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/charge-DiOprsaJ.js","assets/checksum-B9s_4xdE.js","assets/codec-DOoWeNvh.js","assets/config-Cqo63nnv.js","assets/core-BIBDu-_R.js","assets/de-CL76MmlE.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/events-9ce18a08.esm-DuiLxLBf.js","assets/files-CdfAAl3C.js","assets/fr-B95_4Osh.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-9_GQr7ys.js","assets/hooks-Bt69Sn_a.js","assets/http-DsMvGxqT.js","assets/index-DmXVUgY0.js","assets/index-Dmm8Kpu_.css","assets/jsx-runtime-NZYk81nU.js","assets/layout-DXNyJJJ3.js","assets/lesson-C7x61Bwy.js","assets/levels-DlkUqTaf.js","assets/local-B_DaKTPH.js","assets/mailbox-C4LGIvqj.js","assets/nostr-Cbmdu9RJ.js","assets/packageChange-Be729-6H.js","assets/page-BRHMhY3k.js","assets/post-DlIlJbNk.js","assets/printPlay-CoqiV3G_.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-BMWFGayi.js","assets/rift-lanterns-BrpR-PPJ.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/site-B823XLVz.js","assets/sound-BoKCmwOI.js","assets/standIns-OXIxWlRR.js","assets/store-CVs2Df1Q.js","assets/store-CtK9LZCb.js","assets/store-DFV_kSd_.js","assets/syntax-CEL_Wvla.js","assets/talk-MEMpYTB7.js","assets/three.module-B9uX-pKs.js","assets/trystero-DWViwSsW.js","assets/trystero-U-wyGnZX.js","assets/worker-Cz3COC_Z.js","assets/worker-X3JoFKas.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
