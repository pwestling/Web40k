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
const VERSION = "0c277015dec1";
const FILES = ["assets/Board-Co1GJY0x.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-CEToecm4.js","assets/CommandPanel-DunwH8D0.js","assets/CommandPanel-HSM8_TTC.js","assets/Editor-C6YG7kLt.js","assets/EventSeat-Cal1AzuM.js","assets/EventsUI-DPjZl22s.js","assets/FigureLibrary-DoFkE3UV.js","assets/GameScreen-B62fLkMi.js","assets/MailLobby-BVsTlb46.js","assets/Miniatures-De0spM-b.js","assets/OpenTables-BEpOjlyU.js","assets/PhotoMatch-Dod1WEfd.js","assets/PlayerCard-D8AmoJNj.js","assets/RankedGame-CUkN488h.js","assets/RulesPage-CiSiho6r.js","assets/StandeeMaker-CH2VdHh5.js","assets/TableWarnings-CVKx5KBS.js","assets/Workshop-Uy2Ehes5.js","assets/_virtual_sandbox-worker-BlyBgWG4.js","assets/_virtual_soak-worker-CFqK-8QE.js","assets/actions-Xne2uH98.js","assets/aws4fetch.esm-BLUAl4pF.js","assets/base64-gMTPUZJI.js","assets/book-BtQHBJM_.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CZky51Uj.js","assets/core-CLzHMQrM.js","assets/de-6qyFiGLu.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-qvOJhGA3.js","assets/files-CdfAAl3C.js","assets/fr-c2SWsBxW.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-CpNsDbuv.js","assets/help-DM7vWaLl.js","assets/http-dlURkvNA.js","assets/idb-OWIpJU7O.js","assets/index-C1_iSxfK.css","assets/index-ChdkobIP.js","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-Bc86_BK6.js","assets/lesson-FsKsyWKf.js","assets/levels-DlkUqTaf.js","assets/local-9p3mR9ZU.js","assets/mailbox-DwFnDr5h.js","assets/manifest-bE-32xpp.js","assets/meshShape-BsiI-w3H.js","assets/nostr-BvJKi1bv.js","assets/pack-DFLugDGr.js","assets/packageChange-Be729-6H.js","assets/page-CRl1owgf.js","assets/play-D6MneuPN.js","assets/post-Bxrngi05.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-DpSEbBgM.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/react-hsrUxga6.js","assets/replayFile-BEhIN6Lw.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CVZButfQ.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelfActions-LuKAXnMB.js","assets/showcase-Dcyx4k9V.js","assets/site-B823XLVz.js","assets/sound-D-PZn1qw.js","assets/standIns-BHeYT5qd.js","assets/store-7cfV2WT-.js","assets/store-BUzNi0iy.js","assets/store-CBp3SLd5.js","assets/store-DnJURE-9.js","assets/store-sVXFd9pU.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-C48WCVEB.js","assets/talk-BsLq0wUb.js","assets/three.module-BnHMTVNq.js","assets/thumb-CTriGF0U.js","assets/trystero-D4DPU9qP.js","assets/trystero-DWY-0t1C.js","assets/trystero-dNljToKp.js","assets/webtorrent.min-DeIqevk6.js","assets/worker-7HqIyvDb.js","assets/worker-CAnGVa8a.js","assets/worker-CtrB5Iye.js","assets/worker-DV1DuzPc.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
