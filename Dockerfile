FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build \
 && npm prune --omit=dev \
 && rm -rf .next/cache

FROM node:22-bookworm-slim
WORKDIR /app
# Every driver ships in the image, and /app is read-only to the runtime user,
# so the UI's driver install/uninstall is switched off rather than left failing.
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 BAKLAVA_DISABLE_DRIVER_INSTALL=1
COPY --from=build /app/package.json /app/next.config.ts ./
COPY --from=build /app/src/techs/server-packages.generated.ts ./src/techs/
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
# Pre-created so a named volume mounted here starts out owned by `node`.
RUN install -d -o node -g node -m 700 /home/node/.baklava
USER node
EXPOSE 3000
# Loopback by default, like `npm start`: with `--network host` the console is on
# the host's own localhost. Behind `-p` (bridge network) append `-H 0.0.0.0`.
ENTRYPOINT ["node_modules/.bin/next", "start"]
CMD ["-H", "127.0.0.1"]
