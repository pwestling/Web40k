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
const VERSION = "bd993391faa0";
const FILES = ["assets/Board-CLwxWvLI.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-DEE6Q9Nc.js","assets/CommandPanel-DVTTvrB3.js","assets/CommandPanel-DyPLrAAx.js","assets/Editor-d3mqyuG8.js","assets/EventSeat-4X-QQvpW.js","assets/EventsUI-CwdHn0gl.js","assets/FigureLibrary-Bge5PfsE.js","assets/GameScreen-TOFTyrQR.js","assets/MailLobby-CVzdzafU.js","assets/Miniatures-CB8uuLq9.js","assets/OpenTables-ze00dDNX.js","assets/PhotoMatch-B-QI3ft0.js","assets/PlayerCard-Bfjp1FKR.js","assets/RankedGame-CqbBd8ww.js","assets/RulesPage-DmMA2mNK.js","assets/StandeeMaker-DjTUtbAF.js","assets/TeachRule-JBV1zpbQ.js","assets/Workshop-DztiIhoC.js","assets/_virtual_sandbox-worker-CJOrGCtB.js","assets/_virtual_soak-worker-CZdxzJb5.js","assets/actions-CSsmK1wO.js","assets/aws4fetch.esm-BLUAl4pF.js","assets/base64-gMTPUZJI.js","assets/book-Dl6kt33L.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CZky51Uj.js","assets/core-C3_SQgvE.js","assets/de-B39rRNmM.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-qvOJhGA3.js","assets/files-CdfAAl3C.js","assets/fr-BzbDH8tw.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-zogUiscg.js","assets/help-DmF86UhW.js","assets/http-ehFxn5mI.js","assets/idb-OWIpJU7O.js","assets/index-BrElkLzk.css","assets/index-k9XgpEQa.js","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-BO08NZM6.js","assets/lesson-Cr0ncm1c.js","assets/levels-DlkUqTaf.js","assets/local-Bwcjlqzo.js","assets/mailbox-BvV4Y4BL.js","assets/manifest-BRIPGYy3.js","assets/meshShape-BHRONpb4.js","assets/nostr-DrbSMMtL.js","assets/pack-B1M0yHF-.js","assets/packageChange-Be729-6H.js","assets/page-DC63y9JF.js","assets/play-CDt4w1aU.js","assets/post-DugaKXxw.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-BmqDOpuT.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/react-hsrUxga6.js","assets/replayFile-Dp332EAE.js","assets/report-Ay2puqsS.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CVZButfQ.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelfActions-B_20vhuM.js","assets/showcase-Dcyx4k9V.js","assets/site-B823XLVz.js","assets/sound-BYXSO4hD.js","assets/standIns-BHeYT5qd.js","assets/store-BxJWNfOV.js","assets/store-C29_j1Kj.js","assets/store-DPvI0a7o.js","assets/store-W0zuV-2q.js","assets/store-qtJCpkyu.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-D2sKYN4W.js","assets/talk-C1-Fk9kP.js","assets/three.module-BnHMTVNq.js","assets/thumb-X4atBe5A.js","assets/trystero-BJ-suw3F.js","assets/trystero-DXLezl23.js","assets/trystero-dNljToKp.js","assets/webtorrent.min-DeIqevk6.js","assets/worker-8KYtsvIV.js","assets/worker-CtrB5Iye.js","assets/worker-DFVu_0Gt.js","assets/worker-DV1DuzPc.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
