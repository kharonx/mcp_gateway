FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    MCP_MODE=http \
    PORT=3000
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# settings.json + oauth-clients.json + audit logs live here - mount as volume
RUN mkdir -p /app/data /app/logs
EXPOSE 3000
CMD ["node", "dist/index.js", "--http"]
