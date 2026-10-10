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
const VERSION = "6002874862a7";
const FILES = ["assets/Board-g9k_QvRc.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-BRmL7Ijh.js","assets/CommandPanel-D0e1Ws4W.js","assets/CommandPanel-DvVXj__W.js","assets/Editor-Bck0z6Gc.js","assets/EventSeat-CviqAC2A.js","assets/EventsUI-RSEV3RZu.js","assets/FigureLibrary-DXK1hJb4.js","assets/GameScreen-BWiMvTbl.js","assets/MailLobby-BjM_u3e8.js","assets/Miniatures-CW2Pcgdr.js","assets/OpenTables-B-PF3pCD.js","assets/PhotoMatch-D7WZ9J9J.js","assets/PlayerCard-BRZI7B0U.js","assets/RankedGame-B-nP81Ok.js","assets/RulesPage-BURNZpD5.js","assets/StandeeMaker-RJbHMWag.js","assets/TableWarnings-DfosCEnE.js","assets/Workshop-V_EWeK9d.js","assets/_virtual_sandbox-worker-BC2NVjiQ.js","assets/_virtual_soak-worker-D1G3idnd.js","assets/actions-BYlQ0OyX.js","assets/base64-gMTPUZJI.js","assets/book-C3Fx3t0X.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-Kg6xkhHB.js","assets/core-D4BB8IIv.js","assets/de-BprW6f7Y.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-qvOJhGA3.js","assets/files-CdfAAl3C.js","assets/fr-CCQBX4i3.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-DR5Ybx1B.js","assets/help-jjNCJE6k.js","assets/http-B64R-v4c.js","assets/idb-OWIpJU7O.js","assets/index-C4rxERlD.css","assets/index-DaGcOps-.js","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-Cod47mAF.js","assets/lesson-C0LZqPC3.js","assets/levels-DlkUqTaf.js","assets/local-DbeHNIMH.js","assets/mailbox-Li9LxgAW.js","assets/manifest-BCSIyRwj.js","assets/meshShape-D7LPQ4BA.js","assets/nostr-DQl8W0jF.js","assets/pack-DF1Qlhpn.js","assets/packageChange-Be729-6H.js","assets/page-BJ1IjMfJ.js","assets/play-CNCZcVJn.js","assets/post-T_vOuMFo.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-Dibc0ZXQ.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-Oiy9GCXO.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CVZButfQ.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelfActions-DgSxI6Mo.js","assets/showcase-CxKuZj8n.js","assets/site-B823XLVz.js","assets/sound-BLRHRCsS.js","assets/standIns-BHeYT5qd.js","assets/store-BUKi-pQ9.js","assets/store-C20idi4d.js","assets/store-CBYqweh5.js","assets/store-CiGBfXtD.js","assets/store-JctBj4kX.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-CTJ9w-Lv.js","assets/talk-Dvg-MlPx.js","assets/three.module-BnHMTVNq.js","assets/thumb-Cg4eIKqw.js","assets/trystero-B6gLvrIU.js","assets/trystero-CnTvyFix.js","assets/webtorrent.min-DeIqevk6.js","assets/worker-CtrB5Iye.js","assets/worker-DV1DuzPc.js","assets/worker-DlZXgsJk.js","assets/worker-Ds2GJKg0.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
