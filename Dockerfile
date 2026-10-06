FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY --chown=node:node . .
RUN mkdir -p /app/.data/uploads /app/.data/kv && chown -R node:node /app/.data

ENV LOCAL_STORAGE=0
ENV PORT=8080
EXPOSE 8080

# Sin privilegios de root dentro del contenedor.
USER node

CMD ["node", "scripts/server.mjs"]
