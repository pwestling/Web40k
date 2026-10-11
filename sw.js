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
const VERSION = "c9f70a414f28";
const FILES = ["assets/Board-BDBf0_yB.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-4jJSOMIP.js","assets/CommandPanel-Bv0yX0Yn.js","assets/CommandPanel-c32JVFNJ.js","assets/Editor-ChSIGLqG.js","assets/EventSeat-B66sv6_k.js","assets/EventsUI-CG2Q6qho.js","assets/FigureLibrary-ClgrwO4p.js","assets/GameScreen-CoaYxLjk.js","assets/MailLobby-684xUDBm.js","assets/Miniatures-CpIyXIaf.js","assets/OpenTables-C0v4SfRU.js","assets/PhotoMatch-B9friTUv.js","assets/PlayerCard-3doVMZXI.js","assets/RankedGame-ALpe9DRp.js","assets/RulesPage-CSabvMl_.js","assets/StandeeMaker-BVPOBkNu.js","assets/TeachRule-BAgvpEXu.js","assets/Workshop-ByiJdEy_.js","assets/_virtual_sandbox-worker-CJOrGCtB.js","assets/_virtual_soak-worker-DgXq4Y53.js","assets/actions-BYgcKovQ.js","assets/aws4fetch.esm-BLUAl4pF.js","assets/base64-gMTPUZJI.js","assets/book-DmCiVqDU.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CZky51Uj.js","assets/core-yzCzU_yS.js","assets/de-BHuI2-57.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-qvOJhGA3.js","assets/files-CdfAAl3C.js","assets/fr-CpmsKaOX.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-BeZVSSSE.js","assets/help-BYBwYHHh.js","assets/http-DvfOKISo.js","assets/idb-OWIpJU7O.js","assets/index-B2_nPwNJ.js","assets/index-qKMv44Qs.css","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-GsFvfScH.js","assets/lesson-DYOHKv57.js","assets/levels-DlkUqTaf.js","assets/local-CR2cFG2x.js","assets/mailbox-CIBoh7PG.js","assets/manifest-BRIPGYy3.js","assets/meshShape-DSfAGBbL.js","assets/nostr-D6uts4K2.js","assets/pack-C8RnQeEq.js","assets/packageChange-Be729-6H.js","assets/page-BNiS8FAk.js","assets/play-CfbYMcAM.js","assets/post-DJRnIcbU.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-CUZajfrU.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/react-hsrUxga6.js","assets/replayFile-Cx7qXcVO.js","assets/report-BTbKTElZ.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CVZButfQ.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelfActions-CCwLYDlr.js","assets/showcase-Dcyx4k9V.js","assets/site-B823XLVz.js","assets/sound-BJP4pGC9.js","assets/standIns-BHeYT5qd.js","assets/store-CLb8S1ZX.js","assets/store-DrWNdNBm.js","assets/store-FZcLMXCt.js","assets/store-e-7nUV2d.js","assets/store-sKpLz1U4.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-CB6TTERO.js","assets/talk-Bkr_v_mj.js","assets/three.module-BnHMTVNq.js","assets/thumb-Dq5yAaUx.js","assets/trystero-BJgfkwpV.js","assets/trystero-DfVDKno5.js","assets/trystero-dNljToKp.js","assets/webtorrent.min-DeIqevk6.js","assets/worker-C0IjCeG9.js","assets/worker-CtrB5Iye.js","assets/worker-D8RPRIPm.js","assets/worker-DV1DuzPc.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
