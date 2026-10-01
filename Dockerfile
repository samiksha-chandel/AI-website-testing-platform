FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    default-jre-headless curl ca-certificates tar \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://github.com/zaproxy/zaproxy/releases/download/v2.17.0/ZAP_2.17.0_Linux.tar.gz \
    | tar -xz -C /opt

WORKDIR /app

COPY package*.json ./
RUN npm install

RUN npx playwright install --with-deps chromium

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