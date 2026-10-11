# Open Battle on Craftworld

The public site at https://openbattle.thehivemind5.com runs on Craftworld (vps-01), a NixOS
host. It is the same stack as the docker compose kit in [docs/self-host.md](../../docs/self-host.md),
run as NixOS services with nginx in place of Caddy:

| Path | Service | Port |
|---|---|---|
| `/`, `/health` | nginx serves `/srv/openbattle/current/dist` | 443 |
| `/relay`, `/config.json`, `/health.json` | `openbattle-relay` (server/relay.mjs) | 4400 |
| `/mailbox` | `openbattle-mailbox` (server/mailbox.mjs) | 4401 |
| `/seed` | `openbattle-seeder` (server/seeder.mjs) | 4402 |
| `/host/` | `openbattle-host` (server/host.mjs) | 4403 |
| TURN | `coturn` | 3478 UDP/TCP, relays on UDP 49160–49359 |

State lives in `/var/lib/openbattle/{mailbox,seed,host}`. Releases live in
`/srv/openbattle/releases/<time>-<rev>`, with `/srv/openbattle/current` pointing at one.

## First deploy

All of this runs from Porter's Mac, where the infra checkout and Tailscale SSH are.

1. **Infra module.** Copy `openbattle.nix` to the infra repo as `hosts/vps-01/apps/openbattle.nix`
   and import it from `hosts/vps-01/configuration.nix`.
2. **Secret.** One TURN secret, stored twice in `hosts/vps-01/secrets/openbattle.yaml`:
   ```sh
   secret=$(openssl rand -hex 32)
   printf 'environment: "TURN_SECRET=%s"\nturn-secret: "%s"\n' "$secret" "$secret" \
     > hosts/vps-01/secrets/openbattle.yaml
   scripts/sops.sh -e -i hosts/vps-01/secrets/openbattle.yaml
   ```
   Until this file exists the module adds nothing but the release directory.
3. **DigitalOcean firewall** (`vps-01-admin`). TCP 443 is already open. TURN needs:
   ```sh
   doctl --context personal-vps compute firewall add-rules d3652637-698e-40cd-bda8-a4b0c8797dd2 \
     --inbound-rules 'protocol:tcp,ports:3478,address:0.0.0.0/0,address:::/0 protocol:udp,ports:3478,address:0.0.0.0/0,address:::/0 protocol:udp,ports:49160-49359,address:0.0.0.0/0,address:::/0'
   ```
4. **DNS.** Cloudflare zone `thehivemind5.com`: A `openbattle` → `164.90.155.4`, DNS only, TTL 60.
   Without it the name falls to the `*.thehivemind5.com` wildcard (RackNerd).
5. **Release, then infra.** `deploy/craftworld/release.sh` puts the build in place (it skips the
   restart while the services don't exist yet). Then commit the infra change and run
   `scripts/deploy.sh` in the infra repo; nginx gets its certificate and the services start.
6. **Check.** `https://openbattle.thehivemind5.com/health` should show the relay and TURN as up.
   Two browsers on different networks with `?forceTurn=1` should connect through TURN.

## Later releases

`deploy/craftworld/release.sh` from a clean checkout of main. It builds the committed HEAD,
uploads it, switches `current` and restarts the four services. Roll back by pointing `current`
at an older release and restarting them.
