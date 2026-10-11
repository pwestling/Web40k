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
const VERSION = "eede8af2850c";
const FILES = ["assets/Board-CPyIssC3.js","assets/BufferGeometryUtils-Bg58SzpS.js","assets/CommandPanel-BmblfEUY.js","assets/CommandPanel-BzppivFo.js","assets/CommandPanel-wzcKcVkX.js","assets/Editor-9LaP9qrG.js","assets/EventSeat-DcjGzung.js","assets/EventsUI-DVCRJEUE.js","assets/FigureLibrary-C-spbUzS.js","assets/GameScreen-DOSvZf2z.js","assets/MailLobby-BIx9XwAF.js","assets/Miniatures-Ssu80i2-.js","assets/OpenTables-5WNa65aZ.js","assets/PhotoMatch-BoucotPu.js","assets/PlayerCard-Dju9IfeC.js","assets/RankedGame-LK06WHUA.js","assets/RulesPage-DmMA2mNK.js","assets/StandeeMaker-C-b9ClC4.js","assets/TeachRule-BOvs9nE0.js","assets/Workshop-DXOYTD87.js","assets/_virtual_sandbox-worker-CJOrGCtB.js","assets/_virtual_soak-worker-B_jLzVxm.js","assets/actions-C62NfgKl.js","assets/aws4fetch.esm-BLUAl4pF.js","assets/base64-gMTPUZJI.js","assets/book-Dl6kt33L.js","assets/brinewatch-DN2-OwGh.js","assets/browser-UgmTalj_.js","assets/browser-bopAeLbn.js","assets/codec-DOoWeNvh.js","assets/config-CZky51Uj.js","assets/core-C3_SQgvE.js","assets/de-B39rRNmM.js","assets/dist-WFp3Oeug.js","assets/dist-YYVtoirG.js","assets/dist-lgRNSFRF.js","assets/file-qvOJhGA3.js","assets/files-CdfAAl3C.js","assets/fr-BzbDH8tw.js","assets/fxp-CNHNYw_7.js","assets/fxp-DcRaohTd.js","assets/gameLog-DZz3BrqG.js","assets/help-CCnsjvpb.js","assets/http-ehFxn5mI.js","assets/idb-OWIpJU7O.js","assets/index-BrElkLzk.css","assets/index-DBRnmQ8d.js","assets/jsx-runtime-NZYk81nU.js","assets/keys-D-MKR9PG.js","assets/layout-BO08NZM6.js","assets/lesson-Cr0ncm1c.js","assets/levels-DlkUqTaf.js","assets/local-Bwcjlqzo.js","assets/mailbox-BvV4Y4BL.js","assets/manifest-BRIPGYy3.js","assets/meshShape-Dj4H2deQ.js","assets/nostr-DrbSMMtL.js","assets/pack-Ci2DrDJb.js","assets/packageChange-Be729-6H.js","assets/page-Pilo8pQ4.js","assets/play-DMhsEh4R.js","assets/post-DugaKXxw.js","assets/preload-helper-BaNbYf_w.js","assets/printPlay-BmqDOpuT.js","assets/react-Cvdyeg_0.js","assets/react-dom-B-VxWsjA.js","assets/react-hsrUxga6.js","assets/replayFile-DXTLwOjg.js","assets/report-C1OM2aEy.js","assets/rift-lanterns-DLDKmR7R.js","assets/rolldown-runtime-CbXtAM7H.js","assets/rolldown-runtime-hePW80VL.js","assets/roster-CVZButfQ.js","assets/rulebook-DYk1I3nk.js","assets/scheduler-C784v2VA.js","assets/secp256k1-yVjC_Axf.js","assets/shelfActions-BUD5kL-k.js","assets/showcase-Dcyx4k9V.js","assets/site-B823XLVz.js","assets/sound-BYXSO4hD.js","assets/standIns-BHeYT5qd.js","assets/store-BGc7p_RK.js","assets/store-BPFMGOV_.js","assets/store-Dtoixc-r.js","assets/store-W0zuV-2q.js","assets/store-uKfPTFCj.js","assets/syntax-CEL_Wvla.js","assets/systemLabels-D2sKYN4W.js","assets/talk-BqSNJVac.js","assets/three.module-BnHMTVNq.js","assets/thumb-D3hzIt1U.js","assets/trystero-CUnfxp-K.js","assets/trystero-dNljToKp.js","assets/trystero-uAEx-bTO.js","assets/webtorrent.min-DeIqevk6.js","assets/worker-CtrB5Iye.js","assets/worker-DGuYd7ci.js","assets/worker-DV1DuzPc.js","assets/worker-k7F0AmEk.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","manifest.webmanifest"];
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
