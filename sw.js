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
const VERSION = "10a054c152d1";
const FILES = ["assets/Board-DvaoWuWQ.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-BeoNdJK_.js","assets/CommandPanel-WFXKasoB.js","assets/CommandPanel-eHDBgrjo.js","assets/Editor-Cw4GtRd8.js","assets/EventSeat-DJ9fMS9O.js","assets/EventsUI-CNWIsMhV.js","assets/FigureLibrary-ys_9M3Gu.js","assets/GameScreen-C0fCD2eI.js","assets/MailLobby-CjRJCMwi.js","assets/Miniatures-Cz-XITZd.js","assets/OpenTables-BgpggVQx.js","assets/PhotoMatch-CSAQiQXa.js","assets/PlayerCard-BV_CuuF5.js","assets/RankedGame-CLc6llxf.js","assets/RulesPage-CGV96hjy.js","assets/StandeeMaker-BhGjgxY2.js","assets/TeachRule-buIDyI1p.js","assets/Workshop-DTfbaEwA.js","assets/_virtual_sandbox-worker-DjOL8jhh.js","assets/_virtual_soak-worker-B5WY0_Ky.js","assets/actions-DhoVCY3-.js","assets/aws4fetch.esm-BLUAl4pF.js","assets/base64-gMTPUZJI.js","assets/book-BdQ3rOiz.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CZky51Uj.js","assets/core-2Lnf2MTK.js","assets/de-Cb3NXO77.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-qvOJhGA3.js","assets/files-CdfAAl3C.js","assets/fr-DiudMnsf.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-CLfbVoCz.js","assets/help-CO-3RPFv.js","assets/http-CN2eKSx3.js","assets/idb-OWIpJU7O.js","assets/index-CP8WrtcB.css","assets/index-DOtE800t.js","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-DmQSDYlI.js","assets/lesson-BkZMAHPe.js","assets/levels-DlkUqTaf.js","assets/local-BtunCO3S.js","assets/mailbox-BOiyb5zg.js","assets/manifest-BRIPGYy3.js","assets/meshShape-BF2ziV9X.js","assets/nostr-m3KOy_Mw.js","assets/pack-Cwet-arC.js","assets/packageChange-Be729-6H.js","assets/page-BSI4Bb6t.js","assets/play-D_ojSPuZ.js","assets/post-DIq9ntzb.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-rTqB8GKl.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/react-hsrUxga6.js","assets/replayFile-CkLtJfAQ.js","assets/report-CHClE_rI.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CVZButfQ.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelfActions-B8TZTC6f.js","assets/showcase-Dcyx4k9V.js","assets/site-B823XLVz.js","assets/sound-BYXSO4hD.js","assets/standIns-BHeYT5qd.js","assets/store-BoSs-eqy.js","assets/store-CSR9zVjP.js","assets/store-DP_n2A3E.js","assets/store-DSrsSogQ.js","assets/store-TxdV_oUV.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-BJZ3k-d6.js","assets/talk-D53IHUYr.js","assets/three.module-BnHMTVNq.js","assets/thumb-CwPfn7-p.js","assets/trystero-BsTXOz_9.js","assets/trystero-Dk4V49WV.js","assets/trystero-dNljToKp.js","assets/webtorrent.min-DeIqevk6.js","assets/worker-CT1DLgeT.js","assets/worker-CtrB5Iye.js","assets/worker-DV1DuzPc.js","assets/worker-fhIE2diT.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
