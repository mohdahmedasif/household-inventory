# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS client
WORKDIR /src/client
COPY client/package.json ./
RUN npm install
COPY client/ ./
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
COPY server/package.json server/.npmrc ./
RUN npm install --omit=dev
COPY server/src ./src
COPY --from=client /src/client/dist ./dist
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "src/index.js"]
