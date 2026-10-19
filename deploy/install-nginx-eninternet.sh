#!/bin/bash
# CAMBIO DE DOMINIO (fase 2). Instala eninternet.tv y deja carrusel.etziel.com en transición
# con rollback automático si nginx -t falla o si plasticosvirgo deja de responder 200.
# Requiere que ya existan los certificados de ambos dominios (ver docs/DESPLIEGUE.md).
set -u
cd ~/carrusel
CONF=/etc/nginx/conf.d/zz-carrusel.conf
CONF_NEW=/etc/nginx/conf.d/zz-eninternet.conf
INC=/etc/nginx/carrusel-cloudflare.inc
PROXY=/etc/nginx/carrusel-proxy.inc
sudo cp -a "$CONF" "$CONF.prev" 2>/dev/null || true
sudo cp -a "$CONF_NEW" "$CONF_NEW.prev" 2>/dev/null || true

sudo install -m 644 nginx-cloudflare.inc "$INC"
sudo install -m 644 nginx-proxy.inc "$PROXY"
sudo install -m 644 nginx-carrusel-transicion.conf "$CONF"
sudo install -m 644 nginx-eninternet.conf "$CONF_NEW"

rollback() {
  echo "ROLLBACK: $1"
  if [ -f "$CONF.prev" ]; then sudo mv "$CONF.prev" "$CONF"; else sudo rm -f "$CONF"; fi
  if [ -f "$CONF_NEW.prev" ]; then sudo mv "$CONF_NEW.prev" "$CONF_NEW"; else sudo rm -f "$CONF_NEW"; fi
  sudo nginx -t >/dev/null 2>&1 && sudo systemctl reload nginx
  exit 1
}

sudo nginx -t 2>&1 | grep -v 'conflicting server name "_"' || true
sudo nginx -t >/dev/null 2>&1 || rollback "nginx -t falló"
sudo systemctl reload nginx
sleep 1

v=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 https://plasticosvirgo.com)
[ "$v" = "200" ] || rollback "plasticosvirgo devolvió $v"
a=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 --resolve eninternet.tv:443:127.0.0.1 https://eninternet.tv/admin)
[ "$a" = "200" ] || rollback "eninternet.tv/admin devolvió $a"
sudo rm -f "$CONF.prev" "$CONF_NEW.prev"
echo "OK instalado (plasticosvirgo=$v)"
