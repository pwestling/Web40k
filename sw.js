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
const VERSION = "14b5332b59e3";
const FILES = ["assets/Board-CYwed3Ty.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-BsVk8O7l.js","assets/CommandPanel-DXd-9FMT.js","assets/CommandPanel-r8ZpZTAD.js","assets/Editor-CYz-kD8U.js","assets/EventSeat-BWfkpWYP.js","assets/EventsUI-CvrJUhui.js","assets/FigureLibrary-CkhzO3u3.js","assets/GameScreen-DCR0_g48.js","assets/MailLobby-MUN5B3B6.js","assets/Miniatures-CrKZeq_d.js","assets/OpenTables-DYQEuDva.js","assets/PlayerCard-CF6Y7jJy.js","assets/RankedGame-DUnBfVxi.js","assets/RulesPage-C4KB3EXZ.js","assets/StandeeMaker-ni4dc3XB.js","assets/TableWarnings-B_qI629C.js","assets/Workshop-IN5ceM8w.js","assets/_virtual_sandbox-worker-Cko_ritB.js","assets/_virtual_soak-worker-DqxLyaif.js","assets/base64-gMTPUZJI.js","assets/book-BPt9Sn4J.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CEb1gVoU.js","assets/core-BDr3zgja.js","assets/de-B_8UgRMQ.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/events-9ce18a08.esm-CXP5i9uT.js","assets/file-BoKMkqUi.js","assets/files-CdfAAl3C.js","assets/fr-DNLgdou1.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-CdqrE_UR.js","assets/help-SDfXydIN.js","assets/hooks-F8suknIR.js","assets/http-VF6CgFx9.js","assets/index-CaPlMSLZ.js","assets/index-DPW3KVmL.css","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-B3FW2G1n.js","assets/lesson-nLZx3Nop.js","assets/levels-DlkUqTaf.js","assets/local-mMnQhqxz.js","assets/mailbox-D_73wfUM.js","assets/nostr-AWNdcjGG.js","assets/packageChange-Be729-6H.js","assets/page-CJObif3B.js","assets/play-B8gjYBUg.js","assets/post-Bx0m8DXU.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-CQz_Os2N.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/replayFile-kX4mD1Pr.js","assets/rift-lanterns-DLDKmR7R.js","assets/riftLanterns-DK_FH3XJ.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CpK43PLW.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelf-Bt35HbGu.js","assets/showcase-BGlouo4h.js","assets/site-B823XLVz.js","assets/sound-Bmm7wAsU.js","assets/standIns-BHeYT5qd.js","assets/store-B2aWAKJY.js","assets/store-Bv8y222N.js","assets/store-CqKtyGRa.js","assets/store-DdQaeB1T.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-zzOevBto.js","assets/talk-CB0ew3ey.js","assets/three.module-BnHMTVNq.js","assets/trystero-BFq5-H4G.js","assets/trystero-BrMl_Sv3.js","assets/worker-By0MHVT_.js","assets/worker-Cre2amT5.js","assets/worker-DVhfuEkR.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
