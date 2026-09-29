# 前端镜像：多阶段构建
#   stage 1 用 Node 构建 React 产物
#   stage 2 用 nginx 托管静态文件并反向代理 /api
FROM node:22-slim AS build

ARG NPM_REGISTRY=https://registry.npmmirror.com

WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm config set registry "${NPM_REGISTRY}" \
 && npm ci --ignore-scripts --no-audit --no-fund

COPY frontend ./
# 纯进程内构建（rollup + TypeScript），不依赖 esbuild 子进程
RUN node scripts/build-offline.mjs

FROM nginx:1.27-alpine

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
