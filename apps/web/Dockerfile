ARG NODE_BASE_IMAGE=node:20-alpine
FROM --platform=linux/amd64 ${NODE_BASE_IMAGE}

# 默认可解析性优先用官方源；国内 CI/构建慢可在 build-arg 设 NPM_REGISTRY=https://registry.npmmirror.com
ARG NPM_REGISTRY=https://registry.npmjs.org/

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# 构建时写入客户端包；发版脚本或 compose build args 注入（见 release.sh、docker-compose）
ARG NEXT_PUBLIC_APP_VERSION=development
ENV NEXT_PUBLIC_APP_VERSION=${NEXT_PUBLIC_APP_VERSION}
ARG NEXT_PUBLIC_APP_BUILD_ID=0
ENV NEXT_PUBLIC_APP_BUILD_ID=${NEXT_PUBLIC_APP_BUILD_ID}

COPY apps/web/package.json /app/package.json
RUN npm config set registry "${NPM_REGISTRY}" \
  && npm config set fetch-timeout 600000 \
  && npm config set fetch-retries 5 \
  && npm install --loglevel info

COPY apps/web /app
COPY packages/shared-types /packages/shared-types

# 仅构建步骤使用 production（否则 npm install 会省略 devDependencies，next build 缺 tsc/tailwind）
RUN NODE_ENV=production npm run build

EXPOSE 3000
CMD ["npm", "run", "start"]
