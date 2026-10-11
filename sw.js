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
const VERSION = "d2ae265a5484";
const FILES = ["assets/Board-C7Grq4jD.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-BCKqEUbL.js","assets/CommandPanel-Dew6uh6r.js","assets/CommandPanel-m3D25w8V.js","assets/Editor-QZdq3nH9.js","assets/EventSeat-D8fIzyyH.js","assets/EventsUI-Fd_Gcd8b.js","assets/FigureLibrary-DAwP2GsM.js","assets/GameScreen-Cle4Yj-g.js","assets/MailLobby-B9_HZx0i.js","assets/Miniatures-GLGp8QvK.js","assets/OpenTables-DG4sc-SL.js","assets/PhotoMatch-1hg1AIQy.js","assets/PlayerCard-CrU_X-Oq.js","assets/RankedGame-Ybca00wD.js","assets/RulesPage-DmMA2mNK.js","assets/StandeeMaker-ClPxAI-M.js","assets/TeachRule-Bialc1Pf.js","assets/Workshop-CGQTArub.js","assets/_virtual_sandbox-worker-CJOrGCtB.js","assets/_virtual_soak-worker-mwG5WVJr.js","assets/actions-BkochX7L.js","assets/aws4fetch.esm-BLUAl4pF.js","assets/base64-gMTPUZJI.js","assets/book-Dl6kt33L.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CZky51Uj.js","assets/core-C3_SQgvE.js","assets/de-B39rRNmM.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-qvOJhGA3.js","assets/files-CdfAAl3C.js","assets/fr-BzbDH8tw.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-BfuusxKI.js","assets/help-Sc_8SU0C.js","assets/http-ehFxn5mI.js","assets/idb-OWIpJU7O.js","assets/index-BrElkLzk.css","assets/index-Bz-DPZw1.js","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-BO08NZM6.js","assets/lesson-Cr0ncm1c.js","assets/levels-DlkUqTaf.js","assets/local-Bwcjlqzo.js","assets/mailbox-BvV4Y4BL.js","assets/manifest-BRIPGYy3.js","assets/meshShape-BQUlb3Y2.js","assets/nostr-DrbSMMtL.js","assets/pack-spRGthKa.js","assets/packageChange-Be729-6H.js","assets/page-Bvuly3gC.js","assets/play-D6ZTh-5V.js","assets/post-DugaKXxw.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-BmqDOpuT.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/react-hsrUxga6.js","assets/replayFile-CQR_gxyc.js","assets/report-1ifvDlIz.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CVZButfQ.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelfActions-B93F12tw.js","assets/showcase-Dcyx4k9V.js","assets/site-B823XLVz.js","assets/sound-BYXSO4hD.js","assets/standIns-BHeYT5qd.js","assets/store-BMZXtrsR.js","assets/store-Ci6UK3SJ.js","assets/store-D_vopcr6.js","assets/store-DaxQ8y4N.js","assets/store-W0zuV-2q.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-D2sKYN4W.js","assets/talk-DAJv-Mzm.js","assets/three.module-BnHMTVNq.js","assets/thumb-BI4e_1_O.js","assets/trystero-DA_RidFi.js","assets/trystero-dNljToKp.js","assets/trystero-dUMr8ZOI.js","assets/webtorrent.min-DeIqevk6.js","assets/worker-C_aKwuWg.js","assets/worker-CtrB5Iye.js","assets/worker-DV1DuzPc.js","assets/worker-Wt3SeTca.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
