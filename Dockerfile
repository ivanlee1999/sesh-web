FROM node:20-slim AS base

# Install dependencies with build tools for native module compilation
FROM base AS deps
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

# Build - rebuild better-sqlite3 here for the builder
FROM base AS builder
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Rebuild native modules for this stage's Node version
RUN npm rebuild better-sqlite3 --build-from-source

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN npm run build

# Production
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/package.json /app/package-lock.json ./

# Native bindings must be rebuilt in the final image, not copied from another
# stage or host, so Node ABI and libc expectations match production runtime.
RUN npm ci --omit=dev --ignore-scripts \
  && npm rebuild better-sqlite3 --build-from-source \
  && npm cache clean --force \
  && chown -R nextjs:nodejs /app/node_modules

RUN mkdir -p /app/data && chown nextjs:nodejs /app/data

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
