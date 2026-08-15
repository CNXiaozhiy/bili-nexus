FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@11 --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
RUN pnpm install --frozen-lockfile --no-audit
COPY . .
RUN pnpm build

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

COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/dist ./dist

RUN pnpm install --prod --frozen-lockfile --no-audit

CMD ["node", "dist/app"]
