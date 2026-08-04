# Dashboard estatico (SPA vanilla real: login JWT + 15 telas conectadas ao
# backend). Servido direto pelo nginx a partir de apps/dashboard/public - sem
# build Node/Vite (o front React desconectado foi removido na consolidacao).
FROM nginx:alpine

COPY docker/dashboard.nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/dashboard/public /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
