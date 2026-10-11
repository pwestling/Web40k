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
const VERSION = "59e8e8c5dea3";
const FILES = ["assets/Board-BnG-ReSi.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-D-_CZL9Q.js","assets/CommandPanel-T5FRO2dO.js","assets/CommandPanel-h3ugJmvL.js","assets/Editor-DQyh-Va_.js","assets/EventSeat-D0KEJeqk.js","assets/EventsUI-BV8TK-7t.js","assets/FigureLibrary-SfC8vF2G.js","assets/GameScreen-CNxwgVX-.js","assets/MailLobby-DD6IWmWM.js","assets/Miniatures-BXuAV1X1.js","assets/OpenTables-D7aOx4dx.js","assets/PhotoMatch-BBz9l0Mg.js","assets/PlayerCard-j6X5ssGR.js","assets/RankedGame-DcYRF-98.js","assets/RulesPage-cj0FqahP.js","assets/StandeeMaker-BPEvDgM7.js","assets/TableWarnings-DzDJ2T_0.js","assets/Workshop-BhlqyFMN.js","assets/_virtual_sandbox-worker-BlyBgWG4.js","assets/_virtual_soak-worker-BF56WkPS.js","assets/actions-7vvcKbsU.js","assets/aws4fetch.esm-BLUAl4pF.js","assets/base64-gMTPUZJI.js","assets/book-DMpPER84.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CZky51Uj.js","assets/core-DzCkEYJI.js","assets/de-BxUhOnEb.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-qvOJhGA3.js","assets/files-CdfAAl3C.js","assets/fr-3LSLKiHT.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-BPbzyapx.js","assets/help-CK5WKU0q.js","assets/http-CcdGbthz.js","assets/idb-OWIpJU7O.js","assets/index-3QQXVjvb.js","assets/index-Di9UYgti.css","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-ClLCpdy4.js","assets/lesson-DRU67wtP.js","assets/levels-DlkUqTaf.js","assets/local-DmqpF7IU.js","assets/mailbox-BiLh8F0s.js","assets/manifest-bE-32xpp.js","assets/meshShape-DRgSH51i.js","assets/nostr-BQQVs14u.js","assets/pack-C7pn7xIn.js","assets/packageChange-Be729-6H.js","assets/page-CGcMWl4-.js","assets/play-JnuqQi9H.js","assets/post-LnJ6XSJV.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-Bff0vBGm.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/react-hsrUxga6.js","assets/replayFile-CyEBBoyy.js","assets/report-CTvvenvI.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CVZButfQ.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelfActions-Dk_t0U_8.js","assets/showcase-Dcyx4k9V.js","assets/site-B823XLVz.js","assets/sound-DnWZ7vN-.js","assets/standIns-BHeYT5qd.js","assets/store-4TqlKfqE.js","assets/store-BEkWv8L2.js","assets/store-CNtK-8sQ.js","assets/store-CxtKxNFA.js","assets/store-DVOBipse.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-D3BOOxam.js","assets/talk-0ZBbHbbs.js","assets/three.module-BnHMTVNq.js","assets/thumb-DF55_44J.js","assets/trystero-4rMdLq62.js","assets/trystero-C__B_KR6.js","assets/trystero-dNljToKp.js","assets/webtorrent.min-DeIqevk6.js","assets/worker-BLWAT4md.js","assets/worker-CtrB5Iye.js","assets/worker-DV1DuzPc.js","assets/worker-DiIOI3H2.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
