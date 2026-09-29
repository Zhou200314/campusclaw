# 后端镜像：Node 22（内置 node:sqlite，需要 >= 22.5）+ Express
# 镜像内只包含源码与生产依赖，不含 .env（见 .dockerignore）
FROM node:22-slim

ARG NPM_REGISTRY=https://registry.npmmirror.com

ENV NODE_ENV=production
WORKDIR /app

# 先装依赖，利用构建缓存
COPY backend/package.json backend/package-lock.json ./
RUN npm config set registry "${NPM_REGISTRY}" \
 && npm ci --omit=dev --no-audit --no-fund \
 && npm cache clean --force

COPY backend/src ./src

# 数据与上传目录（运行时由命名卷挂载覆盖）
RUN mkdir -p /app/data /app/uploads

EXPOSE 8080

# 配置全部来自环境变量；缺少 SESSION_SECRET 时进程会直接退出（失败即停）
CMD ["node", "src/server.js"]
