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
const VERSION = "1bddc6be7317";
const FILES = ["assets/Board-BcT-jlSJ.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-BWinANZ6.js","assets/CommandPanel-CGMWyJPk.js","assets/CommandPanel-DsIPQo6U.js","assets/Editor-BoY7aVcK.js","assets/EventSeat-BvJvBOev.js","assets/EventsUI-Cq-A4_ov.js","assets/FigureLibrary-BezjxGS5.js","assets/GameScreen-B1mVbE_4.js","assets/MailLobby-B6xdyYtz.js","assets/Miniatures-D-ry-KKE.js","assets/OpenTables-xyy8bYDS.js","assets/PhotoMatch-BUMWlE7D.js","assets/PlayerCard-DmgzC2_i.js","assets/RankedGame-Cx9VnrDF.js","assets/RulesPage-B5H84oLl.js","assets/StandeeMaker-CPQ8IJPh.js","assets/TeachRule-CnUQzr2m.js","assets/Workshop-DJnD9QaW.js","assets/_virtual_sandbox-worker-CmAYGbsX.js","assets/_virtual_soak-worker-deDBHt38.js","assets/actions-BmmxiCIk.js","assets/aws4fetch.esm-BLUAl4pF.js","assets/base64-gMTPUZJI.js","assets/book-Cdu7m3hT.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CZky51Uj.js","assets/core-DHUdU0tL.js","assets/de-Cb3NXO77.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-qvOJhGA3.js","assets/files-CdfAAl3C.js","assets/fr-DiudMnsf.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-ZDqHnQZx.js","assets/help-CXjYrLR6.js","assets/http-nXSWrsB7.js","assets/idb-OWIpJU7O.js","assets/index-BTwANRXe.js","assets/index-CP8WrtcB.css","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-BK8pVEa3.js","assets/lesson-BE10vikJ.js","assets/levels-DlkUqTaf.js","assets/local-BdoXhIJx.js","assets/mailbox-YkjvQmbb.js","assets/manifest-BRIPGYy3.js","assets/meshShape-uwOTURyA.js","assets/nostr-DwtGmAt9.js","assets/pack-CQIabnt1.js","assets/packageChange-Be729-6H.js","assets/page-M30IBHWN.js","assets/play-CwoGxyVv.js","assets/post-BnLjlPif.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay--xbq3Ez6.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/react-hsrUxga6.js","assets/replayFile-BOrkMjw3.js","assets/report-CJfmXZdL.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CVZButfQ.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelfActions-85K_vCl7.js","assets/showcase-Dcyx4k9V.js","assets/site-B823XLVz.js","assets/sound-BYXSO4hD.js","assets/standIns-BHeYT5qd.js","assets/store-B2GCwVu-.js","assets/store-BALkiOff.js","assets/store-BTyvU44K.js","assets/store-GfUV0qLT.js","assets/store-kT7BWTSF.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-B-6mu998.js","assets/talk-JokcsGhr.js","assets/three.module-BnHMTVNq.js","assets/thumb-PeNfsPo9.js","assets/trystero-8Qo5KF6w.js","assets/trystero-CI16gj58.js","assets/trystero-dNljToKp.js","assets/webtorrent.min-DeIqevk6.js","assets/worker-BoMMX0lL.js","assets/worker-BttXGVMU.js","assets/worker-CtrB5Iye.js","assets/worker-DV1DuzPc.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
