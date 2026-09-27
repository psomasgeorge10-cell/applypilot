# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Dependencies - cached independently of the source so that editing a component
# does not reinstall node_modules.
# ---------------------------------------------------------------------------
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------------
# Build - produces .next/standalone, a server bundled with only the modules it
# actually reached, including the PostgreSQL driver and schema.sql.
# ---------------------------------------------------------------------------
FROM node:24-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1     BUILD_STANDALONE=true
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------------------------------------------------------------------------
# Worker and seeding - the full source plus dev dependencies, so the tsx
# scripts can run, and a system Chromium for the auto-apply submitter.
# ---------------------------------------------------------------------------
FROM node:24-alpine AS worker
WORKDIR /app
RUN apk add --no-cache chromium
ENV NODE_ENV=development \
    CHROMIUM_PATH=/usr/bin/chromium-browser
COPY --from=deps /app/node_modules ./node_modules
COPY . .
CMD ["npm", "run", "worker"]

# ---------------------------------------------------------------------------
# Runtime - the standalone server only, running as a non-root user.
# ---------------------------------------------------------------------------
FROM node:24-alpine AS runner
WORKDIR /app
# Chromium for "Approve & apply", which submits from the web process.
RUN apk add --no-cache chromium
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    CHROMIUM_PATH=/usr/bin/chromium-browser

RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
