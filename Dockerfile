# syntax=docker/dockerfile:1

# LumeSec Elements as a Next.js standalone server.
#   docker build --build-arg NEXT_PUBLIC_SITE_URL=https://elements.example.com -t elements .
#   docker run -p 3000:3000 elements
# NEXT_PUBLIC_SITE_URL is compiled into the bundles and the registry, so it is a build argument.

FROM node:22-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
# pnpm at the version pinned in package.json ("packageManager"), through Corepack
COPY package.json ./
RUN corepack enable && corepack install

FROM base AS deps
COPY pnpm-lock.yaml .npmrc ./
# install scripts run in the build stage, where the sources the postinstall step reads are present
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM base AS build
ARG NEXT_PUBLIC_SITE_URL=https://elements.lumesec.ai
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm rebuild \
  && pnpm run postinstall \
  && pnpm build

FROM node:22-bookworm-slim AS runner
LABEL org.opencontainers.image.title="LumeSec Elements" \
      org.opencontainers.image.description="Interactive React and custom-element components, and the site that documents them." \
      org.opencontainers.image.source="https://github.com/lumesec/elements-ui" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# the server, its traced files (registry items, sources, content), static assets and public/
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "server.js"]
