# ---------- Build ----------
FROM node:22-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app

COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./
COPY eslint.config.mjs ./
COPY packages/shared/package.json packages/shared/
COPY packages/sdk-ts/package.json packages/sdk-ts/
COPY packages/sdk-js/package.json packages/sdk-js/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/

RUN npm install --workspaces --include-workspace-root

COPY packages ./packages
COPY apps/api ./apps/api
COPY apps/dashboard ./apps/dashboard

RUN npm run build -w packages/shared \
 && npx prisma generate --schema apps/api/prisma/schema.prisma \
 && npm run build -w apps/api \
 && npm test -w apps/api

# ---------- Runtime ----------
FROM node:22-alpine
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/dashboard/public ./apps/dashboard/public

WORKDIR /app/apps/api
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db push && node dist/main.js"]
