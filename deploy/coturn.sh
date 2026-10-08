#!/bin/sh
# Starts coturn for Open Battle: TURN on 3478 (UDP and TCP) with short-lived
# logins signed by TURN_SECRET, which the relay hands to browsers.
set -e
: "${TURN_SECRET:?Set TURN_SECRET in .env}"
# Anyone who knows the secret can use this TURN server: refuse the example one.
if [ "$TURN_SECRET" = "change-me" ] || [ "${#TURN_SECRET}" -lt 16 ]; then
  echo "TURN_SECRET is still the example or shorter than 16 characters. Set a long random one in .env, e.g. openssl rand -hex 32" >&2
  exit 1
fi
# Don't let TURN be used to reach this machine's own private networks, unless
# asked (TURN_ALLOW_PRIVATE=1, e.g. to test with two browsers on one machine).
PRIVATE="--denied-peer-ip=0.0.0.0-0.255.255.255 --denied-peer-ip=10.0.0.0-10.255.255.255 \
  --denied-peer-ip=100.64.0.0-100.127.255.255 --denied-peer-ip=127.0.0.0-127.255.255.255 \
  --denied-peer-ip=169.254.0.0-169.254.255.255 --denied-peer-ip=172.16.0.0-172.31.255.255 \
  --denied-peer-ip=192.168.0.0-192.168.255.255 --denied-peer-ip=::1 --denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"
[ "$TURN_ALLOW_PRIVATE" = 1 ] && PRIVATE="--allow-loopback-peers"
exec turnserver -n --log-file=stdout --no-cli --no-tls --no-dtls \
  --listening-port="${TURN_PORT:-3478}" \
  --min-port="${TURN_MIN_PORT:-49160}" --max-port="${TURN_MAX_PORT:-49359}" \
  --use-auth-secret --static-auth-secret="$TURN_SECRET" \
  --realm="${DOMAIN:-open-battle}" --fingerprint \
  --no-multicast-peers --no-rfc5780 \
  ${TURN_EXTERNAL_IP:+--external-ip="$TURN_EXTERNAL_IP"} \
  $PRIVATE \
  $TURN_EXTRA_ARGS
