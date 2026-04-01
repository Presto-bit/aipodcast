ARG NODE_BASE_IMAGE=node:20-alpine
FROM ${NODE_BASE_IMAGE}

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY apps/web/package.json /app/package.json
RUN npm install

COPY apps/web /app
COPY packages/shared-types /packages/shared-types

# 仅构建步骤使用 production（否则 npm install 会省略 devDependencies，next build 缺 tsc/tailwind）
RUN NODE_ENV=production npm run build

EXPOSE 3000
CMD ["npm", "run", "start"]
