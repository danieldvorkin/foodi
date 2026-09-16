# syntax=docker/dockerfile:1.7
# ---- build ---------------------------------------------------------------------------------
# One image builds all three workspaces; only the runtime pieces are copied into the final stage.
FROM node:26-slim AS build
WORKDIR /app
ENV NODE_ENV=development
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build \
 && npm prune --omit=dev --no-audit --no-fund

# ---- runtime -------------------------------------------------------------------------------
FROM node:26-slim
ENV NODE_ENV=production \
    PORT=8080 \
    FOODI_DB_PATH=/data/foodi.db \
    FOODI_UPLOAD_DIR=/data/uploads
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/shared ./shared
COPY --from=build /app/server/package.json ./server/
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist
COPY deploy/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh && mkdir -p /data && chown node:node /data
# The server resolves ../client/dist relative to its own directory.
WORKDIR /app/server
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "dist/index.js"]
