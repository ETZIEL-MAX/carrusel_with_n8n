#!/bin/bash
# Genera ~/carrusel/.env.prod en el servidor. Los secretos se crean aquí y no salen del EC2.
set -euo pipefail
cd ~/carrusel
umask 077
{
  printf "%s\n" "ADMIN_PASSWORD_HASH='\$argon2id\$v=19\$m=19456,t=2,p=1\$Jh0XC1lAaTMwmkroh0rIZA\$ZbFZ7LNc6QJqk/hbVtOhv1V7rsORlWFOh7OOPKnubTk'"
  printf "JWT_SECRET=%s\n" "$(openssl rand -hex 32)"
  printf "WEBHOOK_SECRET=%s\n" "$(openssl rand -hex 32)"
  printf "UPLOAD_ALLOWED_HOSTS=%s\n" "carrusel.etziel.com,aliyuncs.com,cloudinary.com,res.cloudinary.com,pollinations.ai,image.pollinations.ai"
} > .env.prod
ls -la .env.prod
cut -c1-45 .env.prod | sed -E 's/(SECRET=).*/\1<oculto>/'
