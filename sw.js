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
const VERSION = "d5854fa96911";
const FILES = ["assets/Board-Cb0noLcU.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-BPZYktEp.js","assets/CommandPanel-Cx06CrsM.js","assets/CommandPanel-DZ2mOqx6.js","assets/Editor-CxzkrZIh.js","assets/EventSeat-Md11x5eE.js","assets/EventsUI-Yck5owS2.js","assets/FigureLibrary-CoFPam_l.js","assets/GameScreen-BVR1z2Us.js","assets/MailLobby-BzRcTlyW.js","assets/Miniatures-p7ULXksa.js","assets/OpenTables-_tjz5518.js","assets/PhotoMatch-Co5TE8Rc.js","assets/PlayerCard-DZnRKyyM.js","assets/RankedGame-BdNkrpOC.js","assets/RulesPage-Dp9-QDN1.js","assets/StandeeMaker-CyIvD3Fc.js","assets/TeachRule-DVV7CQ6R.js","assets/Workshop-vrOjoVik.js","assets/_virtual_sandbox-worker-CJOrGCtB.js","assets/_virtual_soak-worker-GSd8up6L.js","assets/actions-BX-qtUR8.js","assets/aws4fetch.esm-BLUAl4pF.js","assets/base64-gMTPUZJI.js","assets/book-BteyTDKY.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CZky51Uj.js","assets/core-qWsis1We.js","assets/de-OhLTHtUK.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-qvOJhGA3.js","assets/files-CdfAAl3C.js","assets/fr-Knou8YV4.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-DtWlmV42.js","assets/help-DjgSzr2V.js","assets/http-CL-zUR48.js","assets/idb-OWIpJU7O.js","assets/index-BPLMXiY4.js","assets/index-DLgDh0SQ.css","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-BM07vC7u.js","assets/lesson-Bg-FbnuY.js","assets/levels-DlkUqTaf.js","assets/local-DkQMF4Z-.js","assets/mailbox-BHFvuZcL.js","assets/manifest-BRIPGYy3.js","assets/meshShape-DJs_k5HD.js","assets/nostr-DPSjXFgb.js","assets/pack-CM0OKEqA.js","assets/packageChange-Be729-6H.js","assets/page-DraUDGoT.js","assets/play-CY_fwXd_.js","assets/post--ToHyV5R.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-cYjAesQN.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/react-hsrUxga6.js","assets/replayFile-n_EpEi43.js","assets/report-Ddn1L0sJ.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CVZButfQ.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelfActions-BXhCZxqu.js","assets/showcase-Dcyx4k9V.js","assets/site-B823XLVz.js","assets/sound-BYXSO4hD.js","assets/standIns-BHeYT5qd.js","assets/store-1LU4dNv5.js","assets/store-55SBJQqs.js","assets/store-C4fP1Wqt.js","assets/store-DoLTM46N.js","assets/store-HKHcVIqI.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-BIMQkRKH.js","assets/talk-CJJ1wP71.js","assets/three.module-BnHMTVNq.js","assets/thumb-ClmC8GyX.js","assets/trystero-D6SmyLKe.js","assets/trystero-dNljToKp.js","assets/trystero-zkZvKfv4.js","assets/webtorrent.min-DeIqevk6.js","assets/worker-B1PF0UpK.js","assets/worker-CtrB5Iye.js","assets/worker-DV1DuzPc.js","assets/worker-DtAUW2wn.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
