FROM node:20-alpine AS build

WORKDIR /app

# Ensure devDependencies are installed during build (vite, typescript, etc.)
ENV NPM_CONFIG_PRODUCTION=false

# Install client dependencies
COPY client/package*.json ./
RUN npm ci

# Build arguments for Vite
ARG VITE_HEALTH_URL
ARG VITE_WS_URL
ENV VITE_HEALTH_URL=$VITE_HEALTH_URL
ENV VITE_WS_URL=$VITE_WS_URL

# Copy client source and shared into /app
COPY client/ ./
COPY shared/ ../shared

RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
