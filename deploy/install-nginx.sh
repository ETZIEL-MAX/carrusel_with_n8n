#!/bin/bash
# Instala el vhost HTTPS de carrusel.etziel.com con rollback automático si
# nginx -t falla o si plasticosvirgo deja de responder 200.
set -u
cd ~/carrusel
CONF=/etc/nginx/conf.d/zz-carrusel.conf
INC=/etc/nginx/carrusel-cloudflare.inc
sudo cp -a "$CONF" "$CONF.prev" 2>/dev/null || true

sudo install -m 644 nginx-cloudflare.inc "$INC"
sudo install -m 644 nginx-carrusel.conf "$CONF"

rollback() {
  echo "ROLLBACK: $1"
  if [ -f "$CONF.prev" ]; then sudo mv "$CONF.prev" "$CONF"; else sudo rm -f "$CONF"; fi
  sudo nginx -t >/dev/null 2>&1 && sudo systemctl reload nginx
  exit 1
}

sudo nginx -t 2>&1 | grep -v 'conflicting server name "_"' || true
sudo nginx -t >/dev/null 2>&1 || rollback "nginx -t falló"
sudo systemctl reload nginx
sleep 1

v=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 https://plasticosvirgo.com)
[ "$v" = "200" ] || rollback "plasticosvirgo devolvió $v"
sudo rm -f "$CONF.prev"
echo "OK instalado (plasticosvirgo=$v)"
