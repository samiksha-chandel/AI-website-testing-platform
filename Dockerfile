FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

# Java (ZAP ke liye) + tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    default-jre-headless curl ca-certificates tar \
    && rm -rf /var/lib/apt/lists/*

# OWASP ZAP 2.17.0
RUN curl -fsSL https://github.com/zaproxy/zaproxy/releases/download/v2.17.0/ZAP_2.17.0_Linux.tar.gz \
    | tar -xz -C /opt

WORKDIR /app

# Backend dependencies
COPY package*.json ./
RUN npm ci

# Chromium + system libraries (Playwright / Puppeteer / Lighthouse)
RUN npx playwright install --with-deps chromium

# Frontend dependencies + build
COPY client/package*.json client/
RUN cd client && npm install

COPY . .
RUN cd client && npm run build

ENV NODE_ENV=production \
    PORT=3001 \
    ZAP_PATH=/opt/ZAP_2.17.0 \
    ZAP_PORT=8090

EXPOSE 3001
CMD ["node", "server.js"]