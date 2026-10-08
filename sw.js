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
const VERSION = "1e64324e5fe5";
const FILES = ["assets/Board-Bi8tUEbO.js","assets/BufferGeometryUtils-xZWDoXM5.js","assets/CommandPanel-C2lGbsBQ.js","assets/CommandPanel-CNeCVP3V.js","assets/Editor-CirgTJ6-.js","assets/FigureLibrary-D54-45Oa.js","assets/GameScreen-D2eGXTpq.js","assets/MailLobby-BFuThyB1.js","assets/Miniatures-Bn64vrxF.js","assets/Packages-BS3GnyNo.js","assets/RulesPage-7sLaYCll.js","assets/TableWarnings-Doi5-8eZ.js","assets/Workshop-FjqkVz07.js","assets/_virtual_sandbox-worker-BllsRM8u.js","assets/_virtual_soak-worker-CRjPQW5D.js","assets/base64-gMTPUZJI.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/charge-x4vS4r37.js","assets/codec-DOoWeNvh.js","assets/de-C53JBX4W.js","assets/dist-D0EAIOa9.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/events-9ce18a08.esm-D2TFJTnU.js","assets/files-CdfAAl3C.js","assets/fr-BJYzawP_.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-Dkyqiipb.js","assets/hooks-Bb5mUf1V.js","assets/index-DX4Fj_aJ.js","assets/index-GK4WXxx6.css","assets/jsx-runtime-NZYk81nU.js","assets/layout-ipTvA_gr.js","assets/lesson-Brvdx5XE.js","assets/levels-DlkUqTaf.js","assets/local-OZw4hLzp.js","assets/packageChange-Be729-6H.js","assets/page-DvHy_rth.js","assets/printPlay-CROENR04.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-uaskTk0R.js","assets/rift-lanterns-BrpR-PPJ.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/scheduler-C784v2VA.js","assets/site-B823XLVz.js","assets/standIns-OXIxWlRR.js","assets/store-BNsaM-Um.js","assets/store-ChamX1Qw.js","assets/store-CoI04siw.js","assets/syntax-CEL_Wvla.js","assets/talk-CLoC_jDR.js","assets/three.module-B9uX-pKs.js","assets/trystero-DOTwfag5.js","assets/trystero-DYVC-IfJ.js","assets/worker-5mJUcHwS.js","assets/worker-X3JoFKas.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
