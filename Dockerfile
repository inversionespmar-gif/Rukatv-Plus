# the node version for running RukaTv Web
ARG NODE_VERSION=22-alpine
FROM node:$NODE_VERSION AS base

# Setup pnpm
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable
RUN apk add --no-cache git

# Meta
LABEL Description="RukaTv Web" Vendor="RukaTv" Version="1.0.0"

RUN mkdir -p /var/www/rukautv-web
WORKDIR /var/www/rukautv-web

# Setup app
FROM base AS app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml /var/www/rukautv-web
RUN pnpm i --frozen-lockfile

COPY . /var/www/rukautv-web
RUN pnpm build

# Setup server
FROM base AS server

RUN pnpm i express@4

# Finalize
FROM base

COPY http_server.js /var/www/rukautv-web
COPY --from=server /var/www/rukautv-web/node_modules /var/www/rukautv-web/node_modules
COPY --from=app /var/www/rukautv-web/build /var/www/rukautv-web/build

EXPOSE 8080
CMD ["node", "http_server.js"]
