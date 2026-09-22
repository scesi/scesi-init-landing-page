# Landing de SCESI init: sitio estático servido por nginx con su configuración
# por defecto. La imagen sin privilegios corre como usuario no-root en el 8080.
# Compresión, HTTPS y encabezados quedan a cargo del proxy del servidor.
FROM nginxinc/nginx-unprivileged:1.27-alpine

COPY index.html site.js graph.js styles.css favicon.svg /usr/share/nginx/html/
COPY img/ /usr/share/nginx/html/img/
COPY speakers/ /usr/share/nginx/html/speakers/

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
