FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build:widgets

FROM node:20-slim AS runtime
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/src ./src
COPY --from=builder /app/assets ./assets
COPY --from=builder /app/tsconfig.json ./
EXPOSE 3001

RUN groupadd -r nodejs && useradd -r -g nodejs -u 1001 nodeuser
USER nodeuser

CMD ["node", "--import", "tsx", "src/index.ts"]
