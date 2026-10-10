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
const VERSION = "4d283c0501be";
const FILES = ["assets/Board-EqOMjcYM.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-CVd0rJOO.js","assets/CommandPanel-DUPpeYL3.js","assets/CommandPanel-DYKIGq_X.js","assets/Editor-DMIcfFx2.js","assets/EventSeat-DbRU5Nlk.js","assets/EventsUI-2yaaSSh_.js","assets/FigureLibrary-cMtMaw9E.js","assets/GameScreen-7RO4iLfo.js","assets/MailLobby-CClYrDa4.js","assets/Miniatures-DDDHaQQ8.js","assets/OpenTables-C8xDvkkp.js","assets/PhotoMatch-Dy437yDR.js","assets/PlayerCard-D9FSKlNB.js","assets/RankedGame-Cs-BakcE.js","assets/RulesPage-Br8u17Sh.js","assets/StandeeMaker-CXxyCmiX.js","assets/TableWarnings-CxSFV59P.js","assets/Workshop-D80T6xby.js","assets/_virtual_sandbox-worker-Cko_ritB.js","assets/_virtual_soak-worker-DqxLyaif.js","assets/base64-gMTPUZJI.js","assets/book-DmvmHGPD.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CEb1gVoU.js","assets/core-BsJR0RlS.js","assets/de-DBrW57WI.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/events-9ce18a08.esm-BqQ__k0Q.js","assets/file-BoKMkqUi.js","assets/files-CdfAAl3C.js","assets/fr-Cfh_LtqE.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-DIFvSzpr.js","assets/help-DRneOWtK.js","assets/hooks-CXfLHfJF.js","assets/http-2yR_qINW.js","assets/idb-OWIpJU7O.js","assets/index-Fg8q2gYY.css","assets/index-c8rJ-xrC.js","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-DYVivoV-.js","assets/lesson-ClL80pOU.js","assets/levels-DlkUqTaf.js","assets/local-CQbsv9CH.js","assets/mailbox-DTHV7TE7.js","assets/nostr-CCx-M7uH.js","assets/packageChange-Be729-6H.js","assets/page-B03R8QE7.js","assets/play-BVelLDzi.js","assets/post-DNBuMD0v.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-e7-BO3aQ.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-B6cL586j.js","assets/rift-lanterns-DLDKmR7R.js","assets/riftLanterns-DQNTO8Ua.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CpK43PLW.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelf-CCxVbm3F.js","assets/showcase-B27xKAOk.js","assets/site-B823XLVz.js","assets/sound-P0dgAzWR.js","assets/standIns-BHeYT5qd.js","assets/store-BNUbX1U7.js","assets/store-C5nSpM8Q.js","assets/store-M0J3A1Oa.js","assets/store-sA03bcB8.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-DHKmuGzK.js","assets/talk-CLSNTpXI.js","assets/three.module-BnHMTVNq.js","assets/thumb-C_uy4EMp.js","assets/trystero-BFq5-H4G.js","assets/trystero-BrMl_Sv3.js","assets/worker-B8eO-JfR.js","assets/worker-C93mc0GI.js","assets/worker-DBUFWTtz.js","assets/worker-DV1DuzPc.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
