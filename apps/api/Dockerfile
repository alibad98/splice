# syntax=docker/dockerfile:1
# One API image (AD-1). Start it with ROLE=http or ROLE=worker (+ WORKER_QUEUES).
# Build from the repo root: docker build -f apps/api/Dockerfile .
FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN npm install -g pnpm@12.11.2
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@slips/api...
RUN pnpm deploy --filter=@slips/api --prod --legacy /out

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]
