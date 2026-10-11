# Open Battle (app repo: pwestling/web40k, deploy/craftworld/openbattle.nix; copy it to the infra
# repo as hosts/vps-01/apps/openbattle.nix): a peer-to-peer tabletop for miniatures wargames.
# Public at https://openbattle.thehivemind5.com. nginx serves the built app and routes to four
# small Node services on loopback: the signalling relay (4400, also /config.json with TURN logins
# and /health.json), the play-by-mail mailbox (4401), the seed node for shared files (4402) and
# the host server that runs games in place of a player's browser (4403). coturn relays game
# traffic for players whose networks block a direct link.
#
# This mirrors the app repo's docker-compose self-host kit (docs/self-host.md), with nginx in
# place of Caddy. The services exist only once secrets/openbattle.yaml exists (keys `environment`,
# a TURN_SECRET=... line, and `turn-secret`, the same secret alone). Releases are built and
# promoted by the app repo's deploy/craftworld/release.sh into /srv/openbattle.
{ config, lib, pkgs, ... }:
let
  domain = "openbattle.thehivemind5.com";
  secretsFile = ../secrets/openbattle.yaml;
  registered = builtins.pathExists secretsFile;
  release = "/srv/openbattle/current";
  state = "/var/lib/openbattle";
  turnPort = 3478;
  # Keep in step with the DigitalOcean firewall rule for TURN relays.
  turnMinPort = 49160;
  turnMaxPort = 49359;

  hardening = {
    User = "openbattle";
    Group = "openbattle";
    Slice = "apps.slice";
    WorkingDirectory = release;
    UMask = "0077";
    Restart = "on-failure";
    RestartSec = "5s";
    TimeoutStopSec = "15s";
    NoNewPrivileges = true;
    PrivateTmp = true;
    ProtectSystem = "strict";
    ProtectHome = true;
    PrivateDevices = true;
    ProtectKernelTunables = true;
    ProtectKernelModules = true;
    ProtectKernelLogs = true;
    ProtectControlGroups = true;
    RestrictSUIDSGID = true;
    RestrictRealtime = true;
    RestrictAddressFamilies = [ "AF_INET" "AF_INET6" "AF_UNIX" "AF_NETLINK" ];
    CapabilityBoundingSet = "";
    AmbientCapabilities = "";
    LimitCORE = 0;
    OOMPolicy = "kill";
    CPUWeight = 100;
  };

  # The relay, mailbox and seed node listen on every address; only loopback (nginx, and the
  # relay's STUN check of coturn) may reach them.
  loopbackOnly = {
    IPAddressDeny = "any";
    IPAddressAllow = "localhost";
  };

  service = { description, script, environment ? { }, serviceConfig ? { }, after ? [ ] }: {
    inherit description environment;
    wantedBy = [ "multi-user.target" ];
    wants = [ "network-online.target" ];
    after = [ "network-online.target" "sops-install-secrets.service" ] ++ after;
    requires = [ "sops-install-secrets.service" ];
    startLimitIntervalSec = 60;
    startLimitBurst = 5;
    unitConfig.ConditionPathExists = "${release}/server/${script}";
    serviceConfig = hardening // {
      ExecStart = "${pkgs.nodejs_22}/bin/node ${release}/server/${script}";
    } // serviceConfig;
  };

  # A location that sets its own header drops the server's, so each repeats nosniff.
  nosniff = "add_header X-Content-Type-Options nosniff always;";
  noCache = ''
    ${nosniff}
    add_header Cache-Control "no-cache" always;
  '';

  proxy = port: {
    proxyPass = "http://127.0.0.1:${toString port}";
    extraConfig = ''
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $remote_addr;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_set_header X-Forwarded-Host $host;
    '';
  };
in
{
  users.groups.openbattle = { };
  users.users.openbattle = {
    isSystemUser = true;
    group = "openbattle";
    hashedPassword = "!";
  };

  systemd.tmpfiles.rules = [ "d /srv/openbattle/releases 0755 root root -" ];

  sops.secrets = lib.mkIf registered {
    "openbattle/environment" = {
      sopsFile = secretsFile;
      key = "environment";
      owner = "openbattle";
      mode = "0400";
      restartUnits = [ "openbattle-relay.service" "openbattle-host.service" ];
    };
    "openbattle/turn-secret" = {
      sopsFile = secretsFile;
      key = "turn-secret";
      owner = "turnserver";
      mode = "0400";
      restartUnits = [ "coturn.service" ];
    };
  };

  systemd.services = lib.mkIf registered {
    openbattle-relay = service {
      description = "Open Battle signalling relay";
      script = "relay.mjs";
      environment = {
        PORT = "4400";
        PUBLIC_URL = "https://${domain}";
        TURN_URLS = "turn:${domain}:${toString turnPort}?transport=udp,turn:${domain}:${toString turnPort}?transport=tcp";
        TURN_CHECK = "127.0.0.1:${toString turnPort}";
        MAILBOX_URL = "on";
        SEEDER_URL = "on";
        HOST_URL = "on";
        OPEN_TABLES = "off";
      };
      serviceConfig = loopbackOnly // {
        EnvironmentFile = config.sops.secrets."openbattle/environment".path;
        MemoryHigh = "192M";
        MemoryMax = "256M";
        TasksMax = 64;
      };
    };

    openbattle-mailbox = service {
      description = "Open Battle play-by-mail mailbox";
      script = "mailbox.mjs";
      environment = {
        PORT = "4401";
        DATA_DIR = "${state}/mailbox";
        TTL_DAYS = "60";
        VAPID_SUBJECT = "mailto:pwestling@gmail.com";
      };
      serviceConfig = loopbackOnly // {
        StateDirectory = "openbattle/mailbox";
        StateDirectoryMode = "0700";
        MemoryHigh = "128M";
        MemoryMax = "192M";
        TasksMax = 64;
      };
    };

    openbattle-seeder = service {
      description = "Open Battle seed node for shared files";
      script = "seeder.mjs";
      environment = {
        PORT = "4402";
        DATA_DIR = "${state}/seed";
        MAX_FILE_MB = "96";
        MAX_TOTAL_GB = "10";
        TTL_DAYS = "30";
        CONTACT = "pwestling@gmail.com";
      };
      serviceConfig = loopbackOnly // {
        StateDirectory = "openbattle/seed";
        StateDirectoryMode = "0700";
        MemoryHigh = "256M";
        MemoryMax = "384M";
        TasksMax = 64;
      };
    };

    coturn.serviceConfig.Slice = "apps.slice";

    # Talks WebRTC to players across the internet, so it keeps outbound access. Its own
    # HTTP port is closed by the host firewall; nginx reaches it on loopback.
    openbattle-host = service {
      description = "Open Battle host server";
      script = "host.mjs";
      after = [ "openbattle-relay.service" "coturn.service" ];
      environment = {
        PORT = "4403";
        DATA_DIR = "${state}/host";
        SIGNAL_URL = "ws://127.0.0.1:4400";
        TURN_URLS = "turn:127.0.0.1:${toString turnPort}?transport=udp,turn:127.0.0.1:${toString turnPort}?transport=tcp";
        MAX_ROOMS = "50";
        IDLE_HOURS = "6";
        KEEP_DAYS = "30";
        # node-datachannel ships a prebuilt library that needs libstdc++.
        LD_LIBRARY_PATH = "${pkgs.stdenv.cc.cc.lib}/lib";
      };
      serviceConfig = {
        EnvironmentFile = config.sops.secrets."openbattle/environment".path;
        StateDirectory = "openbattle/host";
        StateDirectoryMode = "0700";
        MemoryHigh = "768M";
        MemoryMax = "1G";
        TasksMax = 256;
      };
    };
  };

  services.coturn = lib.mkIf registered {
    enable = true;
    realm = domain;
    listening-port = turnPort;
    min-port = turnMinPort;
    max-port = turnMaxPort;
    use-auth-secret = true;
    static-auth-secret-file = config.sops.secrets."openbattle/turn-secret".path;
    no-cli = true;
    no-tls = true;
    no-dtls = true;
    extraConfig = ''
      fingerprint
      no-multicast-peers
      no-rfc5780
      external-ip=164.90.155.4
      # Never relay into this machine's own or private networks (loopback, tailnet, DO VPC).
      denied-peer-ip=0.0.0.0-0.255.255.255
      denied-peer-ip=10.0.0.0-10.255.255.255
      denied-peer-ip=100.64.0.0-100.127.255.255
      denied-peer-ip=127.0.0.0-127.255.255.255
      denied-peer-ip=169.254.0.0-169.254.255.255
      denied-peer-ip=172.16.0.0-172.31.255.255
      denied-peer-ip=192.168.0.0-192.168.255.255
      denied-peer-ip=::1
      denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
    '';
  };

  networking.firewall = lib.mkIf registered {
    allowedTCPPorts = [ turnPort ];
    allowedUDPPorts = [ turnPort ];
    allowedUDPPortRanges = [ { from = turnMinPort; to = turnMaxPort; } ];
  };

  services.nginx.virtualHosts.${domain} = lib.mkIf registered {
    enableACME = true;
    forceSSL = true;
    root = "${release}/dist";
    extraConfig = ''
      access_log off;
      ${nosniff}
    '';
    locations = {
      "/".tryFiles = "$uri $uri/ /index.html";
      # Hashed build assets never change; everything else revalidates after a release.
      "/assets/".extraConfig = ''
        ${nosniff}
        add_header Cache-Control "public, max-age=31536000, immutable" always;
      '';
      "= /index.html".extraConfig = noCache;
      "= /sw.js".extraConfig = noCache;
      "= /health".alias = "${release}/health.html";
      # proxyWebsockets sets HTTP/1.1 and the Upgrade headers for the signalling socket.
      "/relay" = (proxy 4400) // { proxyWebsockets = true; };
      "= /config.json" = proxy 4400;
      "= /health.json" = proxy 4400;
      "/mailbox" = (proxy 4401) // {
        extraConfig = (proxy 4401).extraConfig + "client_max_body_size 17m;";
      };
      "/seed" = (proxy 4402) // {
        extraConfig = (proxy 4402).extraConfig + "client_max_body_size 97m; proxy_request_buffering off;";
      };
      "/host/" = proxy 4403;
    };
  };
}
