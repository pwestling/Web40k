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
const VERSION = "f2b4201ea9f2";
const FILES = ["assets/Board-D_diCCdv.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-BNH8qesH.js","assets/CommandPanel-CEY58RPx.js","assets/CommandPanel-QfB0LOYb.js","assets/Editor-Bkix9pyk.js","assets/EventSeat-BxfK05g6.js","assets/EventsUI-DqA8C-_F.js","assets/FigureLibrary-Dchw2IdT.js","assets/GameScreen-BaT3cVzF.js","assets/MailLobby-BHq5ifoH.js","assets/Miniatures-DQLnyonr.js","assets/OpenTables-D-xYWGB0.js","assets/PhotoMatch-jC8Y8PGf.js","assets/PlayerCard-vK8qsbZj.js","assets/RankedGame-C1I1zM8F.js","assets/RulesPage-DWk4NOkQ.js","assets/StandeeMaker-BJrHXhUl.js","assets/TableWarnings-CFdTAGDt.js","assets/Workshop-D7jL33kQ.js","assets/_virtual_sandbox-worker-BlyBgWG4.js","assets/_virtual_soak-worker-CpU_pXMO.js","assets/actions-DTZ_H4Q9.js","assets/aws4fetch.esm-BLUAl4pF.js","assets/base64-gMTPUZJI.js","assets/book-kQntOcAU.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CZky51Uj.js","assets/core-CHFu6Ej6.js","assets/de-KTNRz2rq.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-qvOJhGA3.js","assets/files-CdfAAl3C.js","assets/fr-CMtlBqtU.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-Ag4cP8jo.js","assets/help-C8PmwRZV.js","assets/http-DKHtY9Mj.js","assets/idb-OWIpJU7O.js","assets/index-BqWMgJEn.js","assets/index-CHp2Zomu.css","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-DWovexVz.js","assets/lesson-BNAO7Lry.js","assets/levels-DlkUqTaf.js","assets/local-CGlSYY9z.js","assets/mailbox-CzCzOmFg.js","assets/manifest-bE-32xpp.js","assets/meshShape-1iAEkRK2.js","assets/nostr-4NAEzhg9.js","assets/pack-Bs0OyRKO.js","assets/packageChange-Be729-6H.js","assets/page-BWYPBhXi.js","assets/play-KQW1fv1t.js","assets/post-Y3u5SH2b.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-BmKS6gtV.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/react-hsrUxga6.js","assets/replayFile-Blk-7IuZ.js","assets/report-HQD0QhrL.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CVZButfQ.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelfActions-CqJlFDIe.js","assets/showcase-Dcyx4k9V.js","assets/site-B823XLVz.js","assets/sound-DnWZ7vN-.js","assets/standIns-BHeYT5qd.js","assets/store-BzKStXCF.js","assets/store-DftxZGRW.js","assets/store-DgR_14j5.js","assets/store-DqIAXZKB.js","assets/store-xtZhCrqV.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-6DVrOey0.js","assets/talk-CbgGwXHv.js","assets/three.module-BnHMTVNq.js","assets/thumb-DntpfYOO.js","assets/trystero-C9787sg7.js","assets/trystero-DfliyhqK.js","assets/trystero-dNljToKp.js","assets/webtorrent.min-DeIqevk6.js","assets/worker-CrPiLKTO.js","assets/worker-CtrB5Iye.js","assets/worker-DV1DuzPc.js","assets/worker-szFkIl_5.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
