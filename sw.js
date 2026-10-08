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
const VERSION = "1d9bbed6b7a9";
const FILES = ["assets/Board-Dt_IbT7G.js","assets/BufferGeometryUtils-xZWDoXM5.js","assets/CommandPanel-Bu_6wOv4.js","assets/CommandPanel-CNeCVP3V.js","assets/Editor-CUC4Hg3Q.js","assets/FigureLibrary-4vM5pKMC.js","assets/GameScreen-DerFt8c-.js","assets/MailLobby-CrzhE_U1.js","assets/Miniatures-CVe0LcSw.js","assets/Packages-CqwY_ys8.js","assets/RulesPage-DI7vAm5k.js","assets/TableWarnings-CB5r_FnF.js","assets/Workshop-BaANv_HP.js","assets/_virtual_sandbox-worker-BllsRM8u.js","assets/_virtual_soak-worker-CRjPQW5D.js","assets/base64-gMTPUZJI.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/charge-Baen1oXX.js","assets/codec-DOoWeNvh.js","assets/de-WeWZ0SZG.js","assets/dist-D0EAIOa9.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/events-9ce18a08.esm-eknjGbdq.js","assets/files-CdfAAl3C.js","assets/fr-BovXCjN1.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-CbDNoa4-.js","assets/hooks-CpKeiwJ5.js","assets/index-BZDXMhtR.css","assets/index-CMmxpC5d.js","assets/jsx-runtime-NZYk81nU.js","assets/layout-B_ptSGOy.js","assets/lesson-DeTjhU-O.js","assets/levels-DlkUqTaf.js","assets/local-BRjuwOeT.js","assets/packageChange-Be729-6H.js","assets/page-BVFwduGV.js","assets/printPlay-BefaEghv.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-CCFAd2m0.js","assets/rift-lanterns-B6bx5n8f.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/scheduler-C784v2VA.js","assets/site-B823XLVz.js","assets/standIns-OXIxWlRR.js","assets/store-BPOhp8Wq.js","assets/store-DCbZjb12.js","assets/store-DyEkVpWv.js","assets/syntax-CEL_Wvla.js","assets/talk-haAmuNwZ.js","assets/three.module-B9uX-pKs.js","assets/trystero-Cr8OAq6R.js","assets/trystero-DYVC-IfJ.js","assets/worker-5mJUcHwS.js","assets/worker-X3JoFKas.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
