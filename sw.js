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
const VERSION = "e0f65dea565d";
const FILES = ["assets/Board-Cbh02gye.js","assets/CommandPanel-DXA0TrZg.js","assets/CommandPanel-worWdmQA.js","assets/Editor-BhOs8iJb.js","assets/FigureLibrary-Dtr4-rHp.js","assets/GameScreen-BAljV-Qe.js","assets/MailLobby-1yzIsGUy.js","assets/Miniatures-DJ-C0uUj.js","assets/TableWarnings-B-wWb4CD.js","assets/Workshop-Bi1CpLlE.js","assets/_virtual_sandbox-worker-D8-sxG5N.js","assets/_virtual_soak-worker-CWd_04-t.js","assets/base64-gMTPUZJI.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/charge-DyBVSZMU.js","assets/codec-D2EJBc5v.js","assets/de-DHVISEM4.js","assets/dist-D0EAIOa9.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/events-9ce18a08.esm-xqoT-QKL.js","assets/fr-BSE4lWrQ.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-Cxya4EzE.js","assets/idb-DXVA_sZR.js","assets/index-B5-4iLGI.js","assets/index-CDAcWHOc.css","assets/jsx-runtime-BtH0gOTJ.js","assets/lesson-DENSdLME.js","assets/levels-DlkUqTaf.js","assets/library-Cg66puPX.js","assets/local-Dmf0Nw9f.js","assets/page-CWzp5cab.js","assets/react-DB-4Zxce.js","assets/replayFile-D3eet43_.js","assets/rift-lanterns-BYDQqtdB.js","assets/rolldown-runtime-CbXtAM7H.js","assets/scheduler-pDGbHDo7.js","assets/showcase-CwGxOFij.js","assets/store-BkQpJ01c.js","assets/store-BlUDnlYC.js","assets/store-bX-StvD1.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-Dea4XAAh.js","assets/talk-Cyddrsir.js","assets/trystero-DSYbFEbb.js","assets/trystero-DYVC-IfJ.js","assets/version-nYkaQkZl.js","assets/worker-DKPnAkbD.js","assets/worker-X3JoFKas.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
