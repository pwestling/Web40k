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
const VERSION = "c9e94285346a";
const FILES = ["assets/Board-DNAU6Ahx.js","assets/BufferGeometryUtils-xZWDoXM5.js","assets/CommandPanel-CUye5vq2.js","assets/CommandPanel-POi8Mlbv.js","assets/CommandPanel-Q6b_s-zJ.js","assets/Editor-rZVNzmXH.js","assets/FigureLibrary-9O2SUH0l.js","assets/GameScreen-DQJi6vyJ.js","assets/MailLobby-DRQe_nzO.js","assets/Miniatures-BCQMnd5C.js","assets/OpenTables-IqufCVpj.js","assets/Packages-BxRW5aOu.js","assets/PlayerCard-nITadgd-.js","assets/RankedGame-BYJgXQw9.js","assets/RulesPage-DcdOuUv0.js","assets/TableWarnings-rFkZHlu5.js","assets/Workshop-CEHidh8l.js","assets/_virtual_sandbox-worker-CKItS_CV.js","assets/_virtual_soak-worker-CB_z6bH1.js","assets/book-DIwLt_2B.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CEb1gVoU.js","assets/core-jjK53DNJ.js","assets/de-D0rFCrgW.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/events-9ce18a08.esm-CGavNSXM.js","assets/files-CdfAAl3C.js","assets/fr-CuhdIfab.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-D9U0f98u.js","assets/help-C5wT_NAT.js","assets/hooks-CvGqshG6.js","assets/http-DNYx-s31.js","assets/index-D3wZsW4I.css","assets/index-DUlrr9M7.js","assets/jsx-runtime-NZYk81nU.js","assets/layout-Da3Da-W5.js","assets/lesson-Cj-yvXuj.js","assets/levels-DlkUqTaf.js","assets/local-975lM6Ny.js","assets/mailbox-jwA-HRUl.js","assets/nostr-ZfrGASd4.js","assets/page-BLSsdc1f.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-BnSTN2AT.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-BWupeLd5.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CpK43PLW.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/setup-BsbEnWiQ.js","assets/shelf-DEB2oGzu.js","assets/showcase-BFNn8_Do.js","assets/site-B823XLVz.js","assets/sound-C9y8oTLY.js","assets/standIns-OXIxWlRR.js","assets/store-BdwsmTC_.js","assets/store-CmdNMc6a.js","assets/store-D1PHmxY0.js","assets/store-Yg_l4hsh.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-BDZNmJiJ.js","assets/talk-C3Pg2l_y.js","assets/three.module-B9uX-pKs.js","assets/trystero-BFq5-H4G.js","assets/trystero-BrMl_Sv3.js","assets/worker-C9CxIR2Z.js","assets/worker-VqMfzZgd.js","assets/worker-X3JoFKas.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
