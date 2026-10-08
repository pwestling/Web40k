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
const VERSION = "0e690441219a";
const FILES = ["assets/Board-CQMMhpyN.js","assets/BufferGeometryUtils-xZWDoXM5.js","assets/CommandPanel-CNeCVP3V.js","assets/CommandPanel-rVK-ynam.js","assets/Editor-2g6hGquf.js","assets/FigureLibrary-DUKUbzVV.js","assets/GameScreen-BZXzbUH7.js","assets/MailLobby-B-2jOneQ.js","assets/Miniatures-BbYF9iNo.js","assets/Packages-Pi-3GdO7.js","assets/RulesPage-BJS5-wG5.js","assets/TableWarnings-Cz7H8yN0.js","assets/Workshop-DlGqCx39.js","assets/_virtual_sandbox-worker-BllsRM8u.js","assets/_virtual_soak-worker-CRjPQW5D.js","assets/base64-gMTPUZJI.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/charge-CPHwra7O.js","assets/codec-DOoWeNvh.js","assets/de-DJuqQrHM.js","assets/dist-D0EAIOa9.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/events-9ce18a08.esm-B0cUDU31.js","assets/files-CdfAAl3C.js","assets/fr-CLKlhDlB.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-ByvdqX03.js","assets/hooks-D9F2Bzmt.js","assets/index-B4BFDILY.js","assets/index-BZDXMhtR.css","assets/jsx-runtime-NZYk81nU.js","assets/layout-Ber1TDyj.js","assets/lesson-DX-eNPfU.js","assets/levels-DlkUqTaf.js","assets/local-DhF6H-l5.js","assets/packageChange-Be729-6H.js","assets/page-QY2YiSs8.js","assets/printPlay-BHsg5gNB.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-C7nMR402.js","assets/rift-lanterns-B6bx5n8f.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/scheduler-C784v2VA.js","assets/site-B823XLVz.js","assets/standIns-OXIxWlRR.js","assets/store-DOUAhK0y.js","assets/store-DmA0UAAJ.js","assets/store-dh3-DN6L.js","assets/syntax-CEL_Wvla.js","assets/talk-DzaNUR79.js","assets/three.module-B9uX-pKs.js","assets/trystero-DYVC-IfJ.js","assets/trystero-Dba2Tuv_.js","assets/worker-5mJUcHwS.js","assets/worker-X3JoFKas.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
