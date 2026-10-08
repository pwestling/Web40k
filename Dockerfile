# Open Battle, self-hosted: the static app behind Caddy, the signalling
# relay, and the play-by-mail mailbox. docker-compose.yml runs both with coturn; see docs/self-host.md.

# Build the app once. It reads its relay and TURN logins from the server's
# config.json at startup (VITE_SITE_CONFIG), so one image fits any domain.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches patches
RUN pnpm install --frozen-lockfile
COPY . .
ENV VITE_SITE_CONFIG=config.json
RUN pnpm build

# The web server: the built app, the health page, and routes to the relay.
FROM caddy:2-alpine AS app
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/dist /srv
COPY deploy/health.html /srv/health.html

# The signalling relay: only its one dependency, at the app's version.
FROM node:22-alpine AS relay
WORKDIR /relay
COPY package.json /tmp/app.json
RUN npm install --omit=dev --no-package-lock --no-audit --no-fund \
      "@trystero-p2p/ws-relay@$(node -p "require('/tmp/app.json').dependencies['@trystero-p2p/ws-relay']")"
COPY server/relay.mjs .
USER node
EXPOSE 8787
CMD ["node", "relay.mjs"]

# The play-by-mail mailbox: plain Node, no dependencies. Files live in /data.
FROM node:22-alpine AS mailbox
WORKDIR /mailbox
COPY server/mailbox.mjs .
RUN mkdir /data && chown node /data
USER node
ENV DATA_DIR=/data
EXPOSE 8790
CMD ["node", "mailbox.mjs"]
