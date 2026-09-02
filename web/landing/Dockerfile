FROM nginx:1.27-alpine

# Static marketing site — single self-contained index.html
COPY index.html /usr/share/nginx/html/index.html

# Small nginx tweak: gzip + long cache for the static asset, SPA-safe fallback
RUN printf 'server {\n\
  listen 8080;\n\
  root /usr/share/nginx/html;\n\
  index index.html;\n\
  gzip on;\n\
  gzip_types text/html text/css application/javascript image/svg+xml;\n\
  location / { try_files $uri $uri/ /index.html; }\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
