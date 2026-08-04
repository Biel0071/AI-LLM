# ---------- Build ----------
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./
COPY eslint.config.mjs ./
COPY packages/shared/package.json packages/shared/
COPY apps/dashboard/package.json apps/dashboard/

RUN npm install --workspaces --include-workspace-root

COPY packages ./packages
COPY apps/dashboard ./apps/dashboard

RUN npm run build -w packages/shared \
 && npm run build -w apps/dashboard

# ---------- Runtime ----------
FROM nginx:alpine

COPY docker/dashboard.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/dashboard/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
