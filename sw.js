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
const VERSION = "be013f25762d";
const FILES = ["assets/Board-Pz97VBZK.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-BOcAT8aF.js","assets/CommandPanel-Bsa8OX0z.js","assets/CommandPanel-DReHgpzy.js","assets/Editor-5t-cvoos.js","assets/EventSeat-inmVCb8I.js","assets/EventsUI-DY5a0XFd.js","assets/FigureLibrary-DtcRidWk.js","assets/GameScreen-BQAW1ow_.js","assets/MailLobby-Bvs6HvsZ.js","assets/Miniatures-VhY5DGEf.js","assets/OpenTables-B6Y4GNCj.js","assets/PhotoMatch-GD67wzN5.js","assets/PlayerCard-Bd-7Yvqc.js","assets/RankedGame-B2O8pMO6.js","assets/RulesPage-BdpzFd_A.js","assets/StandeeMaker-DoEoBqwf.js","assets/TableWarnings-B0rYLgOB.js","assets/Workshop-DqnM-z9x.js","assets/_virtual_sandbox-worker-BlyBgWG4.js","assets/_virtual_soak-worker-Bpxq1o0s.js","assets/actions-6e12BA9I.js","assets/aws4fetch.esm-BLUAl4pF.js","assets/base64-gMTPUZJI.js","assets/book-BNQ1P2bi.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CZky51Uj.js","assets/core-BgmWK3fY.js","assets/de-T4DJstj3.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-qvOJhGA3.js","assets/files-CdfAAl3C.js","assets/fr-B3iw0jk-.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-DiDsTuQS.js","assets/help-DRde_fkJ.js","assets/http-C22YvzHF.js","assets/idb-OWIpJU7O.js","assets/index-DLpApZBl.js","assets/index-Di9UYgti.css","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-_5wIn4MM.js","assets/lesson-B-gQ35kl.js","assets/levels-DlkUqTaf.js","assets/local-BiSqlOX8.js","assets/mailbox-BcbC0qka.js","assets/manifest-bE-32xpp.js","assets/meshShape-CV8PzfKf.js","assets/nostr-Cc_xB6Oc.js","assets/pack-CIl_AeyF.js","assets/packageChange-Be729-6H.js","assets/page-Dsfp5oz1.js","assets/play-ZLBAjl60.js","assets/post-BYfT5KK9.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-_3z-oYcM.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/react-hsrUxga6.js","assets/replayFile-Bc0bRdXY.js","assets/report-DsrnwGpR.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CVZButfQ.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelfActions-BOEeh7fQ.js","assets/showcase-Dcyx4k9V.js","assets/site-B823XLVz.js","assets/sound-DnWZ7vN-.js","assets/standIns-BHeYT5qd.js","assets/store-Ch6EqhOH.js","assets/store-DWnK_igR.js","assets/store-Da6_zfst.js","assets/store-Dd6WQ5tb.js","assets/store-VmLDCJc6.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-DMQiRtSx.js","assets/talk-hwx82Jat.js","assets/three.module-BnHMTVNq.js","assets/thumb-DZXK8zsX.js","assets/trystero-BIqnC-Un.js","assets/trystero-WWKKBdac.js","assets/trystero-dNljToKp.js","assets/webtorrent.min-DeIqevk6.js","assets/worker-Bk9EIjME.js","assets/worker-Crpj-kJS.js","assets/worker-CtrB5Iye.js","assets/worker-DV1DuzPc.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
