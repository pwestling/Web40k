# Open Battle, self-hosted: the static app behind Caddy, and the signalling
# relay. docker-compose.yml runs both with coturn; see docs/self-host.md.

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
