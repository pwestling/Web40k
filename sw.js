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
const VERSION = "414e818b7efb";
const FILES = ["assets/Board-DWIJie0i.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-Bf0IrUXP.js","assets/CommandPanel-CyNDH6TT.js","assets/CommandPanel-GWTRcp60.js","assets/Editor-Bcr6J7Qs.js","assets/EventSeat-SFqbu7EJ.js","assets/EventsUI-AiIkyesb.js","assets/FigureLibrary-Bho5mTAo.js","assets/GameScreen-D_cBj-fK.js","assets/MailLobby-DjrsGQld.js","assets/Miniatures-DaP8a3hd.js","assets/OpenTables-dgSVgkOd.js","assets/PhotoMatch-D1QRoRCl.js","assets/PlayerCard-CcGyyejj.js","assets/RankedGame-TXiv571Y.js","assets/RulesPage-D9bPN3Yb.js","assets/StandeeMaker-BneQGTM7.js","assets/TableWarnings-DQMblBka.js","assets/Workshop-D6ItnfqY.js","assets/_virtual_sandbox-worker-BlyBgWG4.js","assets/_virtual_soak-worker-invegyvl.js","assets/actions-DJvQog_Z.js","assets/aws4fetch.esm-BLUAl4pF.js","assets/base64-gMTPUZJI.js","assets/book-DPr-ZRUt.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CZky51Uj.js","assets/core-DKtXI7SI.js","assets/de-DebyTIVj.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-qvOJhGA3.js","assets/files-CdfAAl3C.js","assets/fr-BGDYf7im.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-BsfdXyuY.js","assets/help-DsO_Waho.js","assets/http-DWCuk1OD.js","assets/idb-OWIpJU7O.js","assets/index-C4rxERlD.css","assets/index-DcrmP1ci.js","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-DqV0ePn4.js","assets/lesson-Bz7Tm3Gu.js","assets/levels-DlkUqTaf.js","assets/local-B06RlV3z.js","assets/mailbox-DY_Uk7TD.js","assets/manifest-bE-32xpp.js","assets/meshShape-CDLahaLb.js","assets/nostr-FaX4K8wv.js","assets/pack-L5rfrBUk.js","assets/packageChange-Be729-6H.js","assets/page-BHxViiKy.js","assets/play-gX5vy5gh.js","assets/post-DsUNVEsV.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-XppmHsrZ.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/react-hsrUxga6.js","assets/replayFile-D-gwk26c.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CVZButfQ.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelfActions-uPu2TG88.js","assets/showcase-Dcyx4k9V.js","assets/site-B823XLVz.js","assets/sound-D-PZn1qw.js","assets/standIns-BHeYT5qd.js","assets/store-CpcsKwH0.js","assets/store-D5O9VykY.js","assets/store-D7vH3dk_.js","assets/store-DKQWIBSp.js","assets/store-L9PG-sdt.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-CC1E2m-u.js","assets/talk-B1ZKl9no.js","assets/three.module-BnHMTVNq.js","assets/thumb-ChxrFW0i.js","assets/trystero-DF67VZv-.js","assets/trystero-DUDRzl84.js","assets/trystero-dNljToKp.js","assets/webtorrent.min-DeIqevk6.js","assets/worker-ClmauPbo.js","assets/worker-CtrB5Iye.js","assets/worker-D1pOjw_M.js","assets/worker-DV1DuzPc.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
