// The browser build of WebTorrent, loaded on demand by src/share/torrent.ts (which types what it uses).
declare module "webtorrent/dist/webtorrent.min.js" {
  const WebTorrent: unknown;
  export default WebTorrent;
}
