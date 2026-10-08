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
const VERSION = "6c947ea23ac2";
const FILES = ["assets/Board-CFWJrehb.js","assets/CommandPanel-DATCkRhI.js","assets/Editor-BELOhjkt.js","assets/FigureLibrary-DQrbev4b.js","assets/GameScreen-CTDXRxVg.js","assets/MailLobby-TmVxMNHt.js","assets/Miniatures-uJCtt68c.js","assets/Workshop-BtUJbUUw.js","assets/_virtual_sandbox-worker-DkVZTDvm.js","assets/_virtual_soak-worker-DKGzDjic.js","assets/base64-gMTPUZJI.js","assets/browser-bopAeLbn.js","assets/codec-D2EJBc5v.js","assets/de-Cl9KNeNg.js","assets/dist-BQvHYO-j.js","assets/dist-D0EAIOa9.js","assets/dist-zGdHVkL9.js","assets/fr-XdnAdNRd.js","assets/fxp-CNHNYw_7.js","assets/gameLog-BsOrnfO9.js","assets/idb-C5EkxhVP.js","assets/index-BTqkOk3l.css","assets/index-CYiSzRSc.js","assets/jsx-runtime-BtH0gOTJ.js","assets/lesson-BS2ylli2.js","assets/levels-DlkUqTaf.js","assets/library-CtaMddUx.js","assets/library-DiFPT9F_.js","assets/local-Bv3thgfe.js","assets/react-DB-4Zxce.js","assets/replayFile-JRu1B4Z8.js","assets/rift-lanterns-DEkpVqNJ.js","assets/runtime-BQuMClnk.js","assets/scheduler-pDGbHDo7.js","assets/showcase-X3aa1LMP.js","assets/store-CvDGGme0.js","assets/store-DYvaRqhp.js","assets/store-DxdrL-g-.js","assets/syntax-CQBQa3WW.js","assets/talk-Dq3MR7Z3.js","assets/trystero-tEW2dYdu.js","assets/version-0WK0bJI-.js","assets/worker-DG9I0sOt.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
