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
const VERSION = "fdd752112e22";
const FILES = ["assets/Board-KA50v1oJ.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-BF-J9KDC.js","assets/CommandPanel-BsVk8O7l.js","assets/CommandPanel-DXd-9FMT.js","assets/Editor-BTsRJ04K.js","assets/EventSeat-JEIGRIC4.js","assets/EventsUI-DnLPaBNS.js","assets/FigureLibrary-BtnbaEM1.js","assets/GameScreen-C2yBlm2H.js","assets/MailLobby-CWClvPU6.js","assets/Miniatures-DBV88EWS.js","assets/OpenTables-BT09Azan.js","assets/PlayerCard-Do4bhLCs.js","assets/RankedGame-BrEReWNQ.js","assets/RulesPage-BglSKlAy.js","assets/StandeeMaker-CPayeXos.js","assets/TableWarnings-B-Xu1FPJ.js","assets/Workshop-DIExJh1p.js","assets/_virtual_sandbox-worker-Cko_ritB.js","assets/_virtual_soak-worker-DqxLyaif.js","assets/base64-gMTPUZJI.js","assets/book-MVoGSaI2.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CEb1gVoU.js","assets/core-e3y3MWgU.js","assets/de-DHy8hMfg.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/events-9ce18a08.esm-DCFNpxyx.js","assets/file-BoKMkqUi.js","assets/files-CdfAAl3C.js","assets/fr-Co0fyiTv.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-OJ1CgRK8.js","assets/help-muYBQf9r.js","assets/hooks-IXIMj5J2.js","assets/http-BpYPz3Pm.js","assets/index-DELZ_2DE.js","assets/index-DPW3KVmL.css","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-BvaH49aQ.js","assets/lesson-Dr1SzVFU.js","assets/levels-DlkUqTaf.js","assets/local-D75_ybgS.js","assets/mailbox-C2QL7cB5.js","assets/nostr-Bv1IJY62.js","assets/packageChange-Be729-6H.js","assets/page-gRD1DTNJ.js","assets/play-_wc_3X3A.js","assets/post-CsCDos7L.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-DwZqGcbs.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-Bu2gz2E_.js","assets/rift-lanterns-DLDKmR7R.js","assets/riftLanterns-CaftHwg7.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CpK43PLW.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelf-lLCzUXr6.js","assets/showcase-C6WXpET0.js","assets/site-B823XLVz.js","assets/sound-DsBQEWAE.js","assets/standIns-BHeYT5qd.js","assets/store-5ip-Q3Hl.js","assets/store-BvwSegzz.js","assets/store-DYuvWCIQ.js","assets/store-hjFBEWem.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-Du-amozk.js","assets/talk-m6rKT1dn.js","assets/three.module-BnHMTVNq.js","assets/trystero-BFq5-H4G.js","assets/trystero-BrMl_Sv3.js","assets/worker-By0MHVT_.js","assets/worker-Cre2amT5.js","assets/worker-DVhfuEkR.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
