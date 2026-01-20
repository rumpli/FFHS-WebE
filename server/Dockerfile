FROM node:20-alpine AS deps
WORKDIR /app
# Ensure devDependencies are installed (so prisma CLI is available)
ENV NPM_CONFIG_PRODUCTION=false
# Install server dependencies
COPY server/package*.json ./
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app/server
COPY --from=deps /app/node_modules ./node_modules
# ensure local .bin is available in PATH for npm scripts in this stage
ENV PATH=/app/server/node_modules/.bin:$PATH
# Copy server source and shared types from the monorepo context
COPY server/ ./
COPY shared/ ../shared
RUN npm run generate && npm run build

FROM node:20-alpine
WORKDIR /app/server
ENV NODE_ENV=production
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/prisma ./prisma
ENV NODE_OPTIONS="--import ./dist/server/src/observability.js"
EXPOSE 8080
CMD sh -c "npx prisma db push --accept-data-loss && npx prisma db seed && node dist/server/src/index.js"
# Used in production when we care about data persistence
#CMD sh -c "npx prisma migrate deploy && node dist/index.js"
