FROM node:20-slim

WORKDIR /app

# Copy project files
COPY package.json package-lock.json* tsconfig.json ./
COPY src/ ./src/
COPY ToolingManifest.json ./

# Install ALL dependencies and build
RUN npm ci && npm run build

ENV NODE_ENV=production
ENV PORT=3978
ENV HOST=0.0.0.0

EXPOSE 3978

RUN groupadd -r nodejs && useradd -r -g nodejs -u 1001 nodeuser
USER nodeuser

CMD ["node", "dist/index.js"]
