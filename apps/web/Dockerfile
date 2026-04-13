ARG NODE_BASE_IMAGE=node:20-alpine
FROM --platform=linux/amd64 ${NODE_BASE_IMAGE}

# 国内机构建 web 时连接 registry.npmjs.org 常极慢或假死；默认 npmmirror，海外可 build-arg NPM_REGISTRY=https://registry.npmjs.org/
ARG NPM_REGISTRY=https://registry.npmmirror.com

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

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
