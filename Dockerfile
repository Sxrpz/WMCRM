# ---- 构建阶段：编译 better-sqlite3 原生模块 ----
FROM node:22-slim AS build

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ---- 运行阶段：精简镜像，不带编译工具 ----
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
