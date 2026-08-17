# ---- Builder stage ----
FROM node:24-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

# ---- Runner stage ----
FROM node:24-slim AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
# Install prod deps, then strip the bundled npm/npx CLI. The runtime only runs
# `node dist/main.js`, and the base image's npm ships vulnerable transitive
# deps (tar, undici, brace-expansion, ip-address) that would otherwise fail the
# release image scan.
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY --from=builder /app/dist ./dist
EXPOSE 3001
# Run as the non-root user shipped in the node image (DS-0002).
USER node
CMD ["node", "dist/main.js"]
