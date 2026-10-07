# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS client
WORKDIR /src/client
COPY client/package.json ./
RUN npm install
COPY client/ ./
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
COPY server/package.json ./
RUN npm install --omit=dev
COPY server/src ./src
COPY --from=client /src/client/dist ./dist
ENV NODE_ENV=production
ENV INVENTORY_DATA_DIR=/data
ENV INVENTORY_API_HOST=0.0.0.0
ENV INVENTORY_API_PORT=3000
EXPOSE 3000
CMD ["node", "src/index.js"]
