# syntax=docker/dockerfile:1.7
# altvivo-core (api.altvivo.bio) - Fastify 5 / Prisma 5 on Node 22 LTS (Alpine)
ARG NODE_IMAGE=node:22.23.3-alpine3.23

# ---------------------------------------------------------------- build ------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
# Toolchain only as a fallback if an argon2 prebuild is unavailable.
RUN apk add --no-cache python3 make g++ openssl
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json ./
COPY db ./db
COPY src ./src
RUN npx prisma generate \
 && npm run build \
 && npm prune --omit=dev --no-audit --no-fund \
 && rm -rf node_modules/.cache

# -------------------------------------------------------------- runtime ------
FROM ${NODE_IMAGE}
RUN apk add --no-cache openssl \
 && addgroup -S -g 10001 altvivo \
 && adduser -S -D -H -u 10001 -G altvivo -s /sbin/nologin altvivo
WORKDIR /app
ENV NODE_ENV=production \
    HOME=/tmp \
    CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1 \
    NODE_OPTIONS=--enable-source-maps
# Code is root-owned and read-only to the service user.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/db ./db
COPY package.json ./
USER 10001:10001
EXPOSE 4000
CMD ["node", "dist/index.js"]
