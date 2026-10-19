#!/bin/bash
# Verificación rápida de ambos sitios en el EC2.
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$@"; }
echo "plasticosvirgo.com      : $(code https://plasticosvirgo.com)"
echo "www.plasticosvirgo.com  : $(code https://www.plasticosvirgo.com)"
echo "virgo next :3000        : $(code http://127.0.0.1:3000)"
echo "carrusel docker :8080   : $(code http://127.0.0.1:8080/admin)"
for d in eninternet.tv carrusel.etziel.com; do
  echo "$d via nginx http : $(code -H "Host: $d" http://127.0.0.1/.well-known/acme-challenge/x)"
  if [ -d /etc/letsencrypt/live/$d ]; then
    echo "$d via nginx https: $(code --resolve $d:443:127.0.0.1 https://$d/admin)  api: $(code --resolve $d:443:127.0.0.1 "https://$d/api/carrusel?userId=USER1")"
  fi
done
sudo docker ps --format '{{.Names}} {{.Status}}'
free -m | awk 'NR<=3'
