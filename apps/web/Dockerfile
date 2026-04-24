ARG NODE_BASE_IMAGE=node:20-alpine
FROM --platform=linux/amd64 ${NODE_BASE_IMAGE}

# 首选源（compose build-arg NPM_REGISTRY）；install 失败时按序换源重试（单源 DNS EAI_AGAIN 等）
ARG NPM_REGISTRY=https://registry.npmjs.org/

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# 构建时写入客户端包；发版脚本或 compose build args 注入（见 release.sh、docker-compose）
ARG NEXT_PUBLIC_APP_VERSION=development
ENV NEXT_PUBLIC_APP_VERSION=${NEXT_PUBLIC_APP_VERSION}
ARG NEXT_PUBLIC_APP_BUILD_ID=0
ENV NEXT_PUBLIC_APP_BUILD_ID=${NEXT_PUBLIC_APP_BUILD_ID}

COPY apps/web/package.json /app/package.json
# 多源回退：先试 NPM_REGISTRY，再官方 / npmmirror / 腾讯云 / 华为云 / 阿里云（ash 兼容）
RUN npm config set fetch-timeout 600000 \
  && npm config set fetch-retries 2 \
  && ok=0 \
  && for reg in "${NPM_REGISTRY}" \
      "https://registry.npmjs.org/" \
      "https://registry.npmmirror.com/" \
      "https://mirrors.cloud.tencent.com/npm/" \
      "https://mirrors.huaweicloud.com/repository/npm/" \
      "https://npm.aliyun.com/"; do \
    echo "npm install: try registry ${reg}"; \
    npm config set registry "${reg}" || continue; \
    if npm install --loglevel info; then ok=1; break; fi; \
  done \
  && test "${ok}" = 1

COPY apps/web /app
COPY packages/shared-types /packages/shared-types

# 仅构建步骤使用 production（否则 npm install 会省略 devDependencies，next build 缺 tsc/tailwind）
RUN NODE_ENV=production npm run build

EXPOSE 3000
CMD ["npm", "run", "start"]
