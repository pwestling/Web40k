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
const VERSION = "819ea64b8e74";
const FILES = ["assets/Board-CdlWb0z_.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-CnhfNfKS.js","assets/CommandPanel-LuPhzQoy.js","assets/CommandPanel-ow5tlUZQ.js","assets/Editor-BwfPhVMS.js","assets/EventSeat-DFTQ2BLf.js","assets/EventsUI-CAQsImFI.js","assets/FigureLibrary-CX60BUdo.js","assets/GameScreen-C1YVxl_J.js","assets/MailLobby-Dwev5QXi.js","assets/Miniatures-BeGkjhoK.js","assets/OpenTables-031wnPiK.js","assets/PhotoMatch-CRkzwnXn.js","assets/PlayerCard-mvwFARks.js","assets/RankedGame-CvczwqGS.js","assets/RulesPage-xwsWPYIt.js","assets/StandeeMaker-O40oNylk.js","assets/TeachRule-CFFgaDGx.js","assets/Workshop-B5xKLyVM.js","assets/_virtual_sandbox-worker-BZ1ObULS.js","assets/_virtual_soak-worker-B8HOKaN_.js","assets/actions-AmB4ovM5.js","assets/aws4fetch.esm-BLUAl4pF.js","assets/base64-gMTPUZJI.js","assets/book-CSZCKGXx.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CZky51Uj.js","assets/core-Ba1GJLt5.js","assets/de-Cb3NXO77.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-qvOJhGA3.js","assets/files-CdfAAl3C.js","assets/fr-DiudMnsf.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-Cd96tFjl.js","assets/help-D7rNjO_u.js","assets/http-HMVf-e8t.js","assets/idb-OWIpJU7O.js","assets/index-CP8WrtcB.css","assets/index-D76YIdYb.js","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-C1iSMzza.js","assets/lesson-DHONYBST.js","assets/levels-DlkUqTaf.js","assets/local-DfHYTVLV.js","assets/mailbox-2IVKN0w7.js","assets/manifest-BRIPGYy3.js","assets/meshShape-BHY22N_s.js","assets/nostr-RbGPiuzu.js","assets/pack-CGIC7vTu.js","assets/packageChange-Be729-6H.js","assets/page-C_Iz4ujf.js","assets/play-BFh2FJyW.js","assets/post-D_9H2aI3.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-9wVJY_DW.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/react-hsrUxga6.js","assets/replayFile-BR8MvH-z.js","assets/report-CMiGEg-a.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CVZButfQ.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelfActions-W2K7xygS.js","assets/showcase-Dcyx4k9V.js","assets/site-B823XLVz.js","assets/sound-BYXSO4hD.js","assets/standIns-BHeYT5qd.js","assets/store-0PBtzIel.js","assets/store-BNwq2RHs.js","assets/store-Bo1bdFB8.js","assets/store-DMIu9pLk.js","assets/store-pL3BDlGx.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-C2BPMBza.js","assets/talk-BbgVl-OP.js","assets/three.module-BnHMTVNq.js","assets/thumb-D47iQ62I.js","assets/trystero-Bl_RAM1p.js","assets/trystero-CCjr1j4U.js","assets/trystero-dNljToKp.js","assets/webtorrent.min-DeIqevk6.js","assets/worker-BrsAO4k0.js","assets/worker-C_aaor23.js","assets/worker-CtrB5Iye.js","assets/worker-DV1DuzPc.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
