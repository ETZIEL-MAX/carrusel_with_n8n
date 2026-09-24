FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm install --omit=dev

COPY . .

ENV LOCAL_STORAGE=1
ENV PORT=8080
EXPOSE 8080

CMD ["node", "scripts/server.mjs"]
