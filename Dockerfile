# Public, read-only CodeGraph demo: the graph of one repo is built into the image at build time, so the running
# service never clones or parses anything a visitor supplies.
#
#   docker build -t codegraph-demo .                                    # Flask 3.1.0 by default
#   docker build -t codegraph-demo --build-arg DEMO_REPO=https://github.com/honojs/hono --build-arg DEMO_REF=v4.6.0 .
#   docker run -p 8080:8080 codegraph-demo                              # http://localhost:8080

# Official Node images via Google's public Docker Hub mirror, which avoids Docker Hub's anonymous pull limits.
# Pass --build-arg NODE_REGISTRY= to pull from Docker Hub directly.
ARG NODE_REGISTRY=mirror.gcr.io/library/
FROM ${NODE_REGISTRY}node:22-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY packages ./packages
RUN npm ci
RUN npm run build:cli

ARG DEMO_REPO=https://github.com/pallets/flask
ARG DEMO_REF=3.1.0
RUN git clone --depth 1 --branch "$DEMO_REF" "$DEMO_REPO" /demo \
 && node packages/cli/dist/bin.js index /demo -o /graph.json

FROM ${NODE_REGISTRY}node:22-bookworm-slim
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build /app/packages/cli/package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/packages/cli/dist ./dist
COPY --from=build /graph.json /data/graph.json
USER node
EXPOSE 8080
CMD ["node", "dist/bin.js", "serve", "--graph", "/data/graph.json"]
