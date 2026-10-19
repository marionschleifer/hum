FROM oven/bun:1.4-slim

WORKDIR /app
COPY package.json tsconfig.json ./
COPY src ./src
COPY web ./web

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["bun", "src/server.ts"]
