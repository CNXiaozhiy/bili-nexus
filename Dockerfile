FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --prefer-offline
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache tzdata && \
    cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime && \
    echo "Asia/Shanghai" > /etc/timezone && \
    apk del tzdata

RUN apk add --no-cache \
    ffmpeg \
    chromium \
    chromium-chromedriver

ENV FFMPEG_BIN="/usr/bin/ffmpeg"
ENV CHROME_BIN="/usr/bin/chromium-browser"
ENV TZ="Asia/Shanghai"

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/dist ./dist

RUN npm ci --omit=dev --no-audit --prefer-offline

CMD ["node", "dist/app"]