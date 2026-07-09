# ---------- Build ----------
FROM node:22-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app

COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/sdk-ts/package.json packages/sdk-ts/
COPY packages/sdk-js/package.json packages/sdk-js/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/

RUN npm install --workspaces --include-workspace-root

COPY packages ./packages
COPY apps/api/prisma ./apps/api/prisma
COPY apps/worker ./apps/worker

RUN npm run build -w packages/shared \
 && npx prisma generate --schema apps/api/prisma/schema.prisma \
 && npm run build -w apps/worker

# ---------- Runtime ----------
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

# OCR opcional via tesseract (OCR_ENGINE=tesseract)
RUN apk add --no-cache openssl ffmpeg tesseract-ocr tesseract-ocr-data-por tesseract-ocr-data-eng

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --from=build /app/apps/worker/package.json ./apps/worker/package.json

WORKDIR /app/apps/worker
CMD ["node", "dist/main.js"]
