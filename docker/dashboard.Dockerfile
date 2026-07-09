FROM nginx:alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/dashboard/public /usr/share/nginx/html
EXPOSE 80
