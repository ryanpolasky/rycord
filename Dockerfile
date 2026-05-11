FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Canonical public origin baked into static metadata, OG/Twitter share URLs,
# JSON-LD, robots.txt, sitemap.xml. Override at build time with:
#   docker build --build-arg NEXT_PUBLIC_SITE_URL=https://my.domain ...
ARG NEXT_PUBLIC_SITE_URL=https://rycord.dev
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV RYCORD_DATA_DIR=/app/data

# Also available at runtime so dynamic server routes (sitemap, robots,
# manifest, og-image) can read it. Override at `docker run -e ...`.
ARG NEXT_PUBLIC_SITE_URL=https://rycord.dev
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/next.config.mjs ./next.config.mjs
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
# Static assets served by Next.js at the site root (favicon, the wall-art
# images, etc.). Without this copy, requests like /forks.png and /coco.jpg
# 404 in prod even though they exist in the repo, because `next start`
# only serves files that actually live under ./public at runtime.
COPY --from=builder /app/public ./public

RUN npm prune --omit=dev && mkdir -p /app/data

EXPOSE 3000

CMD ["./node_modules/.bin/next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
