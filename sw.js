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
const VERSION = "0b9034fd6204";
const FILES = ["assets/Board-CPijhMwF.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-CTZ-0iJz.js","assets/CommandPanel-TCD_ZWPa.js","assets/CommandPanel-V2OKF5oe.js","assets/Editor-CyHv1xnO.js","assets/EventSeat-Dfy086Pt.js","assets/EventsUI-BKa6QHbj.js","assets/FigureLibrary-CjjmUGWP.js","assets/GameScreen-DzlJicZ3.js","assets/MailLobby-DxPJcgou.js","assets/Miniatures-ByUEYHhv.js","assets/OpenTables-CVAkmx5y.js","assets/PhotoMatch-BK4VZjGD.js","assets/PlayerCard-B7cLVEug.js","assets/RankedGame-juF0J3ir.js","assets/RulesPage-LhGnX_di.js","assets/StandeeMaker-CS7c-q36.js","assets/TableWarnings-Bz20h31f.js","assets/Workshop-B4cvQsjA.js","assets/_virtual_sandbox-worker-BlyBgWG4.js","assets/_virtual_soak-worker-CldxnTvL.js","assets/actions-CY603nxm.js","assets/aws4fetch.esm-BLUAl4pF.js","assets/base64-gMTPUZJI.js","assets/book-C64YyOM7.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CZky51Uj.js","assets/core-CHK7LtqD.js","assets/de-C_jCQ1Ko.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-qvOJhGA3.js","assets/files-CdfAAl3C.js","assets/fr-C4eUhsbJ.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-LMl7c0Er.js","assets/help-D8vlJ2ZC.js","assets/http-DMZoDKan.js","assets/idb-OWIpJU7O.js","assets/index-CRgdHTMz.css","assets/index-CymqLCbW.js","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-BHUUCFVd.js","assets/lesson-CjDvmBNZ.js","assets/levels-DlkUqTaf.js","assets/local-vARtOZWy.js","assets/mailbox-CGc8tgPO.js","assets/manifest-bE-32xpp.js","assets/meshShape-DWYTyJKX.js","assets/nostr-6cnic_5p.js","assets/pack-BeR0k3Jz.js","assets/packageChange-Be729-6H.js","assets/page-CIBkACHM.js","assets/play-C5NMopZf.js","assets/post-D3_ujHlJ.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-Cl7yBL3h.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/react-hsrUxga6.js","assets/replayFile-Bem3R0mY.js","assets/report-CxStTqD0.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CVZButfQ.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelfActions-B8hxA3sg.js","assets/showcase-Dcyx4k9V.js","assets/site-B823XLVz.js","assets/sound-D-PZn1qw.js","assets/standIns-BHeYT5qd.js","assets/store-DCST4zWJ.js","assets/store-DnmPNNfm.js","assets/store-EPtHAiuw.js","assets/store-GCcl0bx6.js","assets/store-W1vKOb-6.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-BI2vM3AX.js","assets/talk-BX12Aqou.js","assets/three.module-BnHMTVNq.js","assets/thumb-DmjjxdoJ.js","assets/trystero-6tHzEWoJ.js","assets/trystero-DK75pw4u.js","assets/trystero-dNljToKp.js","assets/webtorrent.min-DeIqevk6.js","assets/worker-2yDA0Cc7.js","assets/worker-BOaM61ii.js","assets/worker-CtrB5Iye.js","assets/worker-DV1DuzPc.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
