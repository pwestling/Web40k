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
const VERSION = "0703a47f605e";
const FILES = ["assets/Board-DNLUdLAy.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-CojcnSb1.js","assets/CommandPanel-D4liEbn4.js","assets/CommandPanel-D5DbLbFb.js","assets/Editor-Cvq1Nmvz.js","assets/EventSeat-Emyycojo.js","assets/EventsUI-C7R0PSEl.js","assets/FigureLibrary--qqBnakh.js","assets/GameScreen-CbWpChdT.js","assets/MailLobby-6pKrR8Fx.js","assets/Miniatures-DoIxfWAK.js","assets/OpenTables-C5fekaum.js","assets/PhotoMatch-DvZzS-Lq.js","assets/PlayerCard-kLVvgFya.js","assets/RankedGame-pLK4ZYTc.js","assets/RulesPage-rUyqVlg6.js","assets/StandeeMaker-B6mnrXvo.js","assets/TableWarnings-ljJxZ29K.js","assets/Workshop-D4Szmfdi.js","assets/_virtual_sandbox-worker-Qu8mmVeP.js","assets/_virtual_soak-worker-B3wrBszo.js","assets/base64-gMTPUZJI.js","assets/book-CkHtb9DN.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CEb1gVoU.js","assets/core-B01MDmAD.js","assets/de-BuUVEPdh.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-BoKMkqUi.js","assets/files-CdfAAl3C.js","assets/fr-1lgzG_kv.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-DCpceRj9.js","assets/help-BLdjmpYB.js","assets/http-CJdc0kmk.js","assets/idb-OWIpJU7O.js","assets/index-CT0qpTA3.js","assets/index-EUhTXr_o.css","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-CcIQHmXa.js","assets/lesson-BO70ROoT.js","assets/levels-DlkUqTaf.js","assets/local-z33aG9tU.js","assets/mailbox-aaVDom6-.js","assets/meshShape-CG_EIfkC.js","assets/nostr-BvwW6NUr.js","assets/packageChange-Be729-6H.js","assets/page-BrlerELe.js","assets/play-udhoQw39.js","assets/post-DUD2ZNRm.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-I-VdVM_N.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-58DrK6CL.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-3qflJCEN.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/showcase-AhLXbPET.js","assets/site-B823XLVz.js","assets/sound-BcHT-Ays.js","assets/standIns-BHeYT5qd.js","assets/store-CCACxYNk.js","assets/store-Cpmg56fh.js","assets/store-D-lPmcRI.js","assets/store-l-R3GP9S.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-sCHMdu2p.js","assets/talk-DF27YWPi.js","assets/three.module-BnHMTVNq.js","assets/thumb-Dy9-WwCM.js","assets/trystero-BFq5-H4G.js","assets/trystero-BrMl_Sv3.js","assets/worker-Bk2eoZhc.js","assets/worker-CtrB5Iye.js","assets/worker-D-nLqDJf.js","assets/worker-DV1DuzPc.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
