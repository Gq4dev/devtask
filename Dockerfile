# ---- Etapa 1: build del cliente (Vite/React) ----
FROM node:22-alpine AS client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---- Etapa 2: runtime (Express + node:sqlite) ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

# Solo dependencias de produccion (express, cors). node:sqlite es built-in.
COPY package*.json ./
RUN npm ci --omit=dev

# Codigo del server y build del cliente ya compilado
COPY server/ ./server/
COPY --from=client /app/client/dist ./client/dist

# La base vive en /data (volumen persistente)
ENV DB_PATH=/data/devtasks.db
VOLUME ["/data"]

EXPOSE 3001
CMD ["node", "--no-warnings", "server/index.js"]
