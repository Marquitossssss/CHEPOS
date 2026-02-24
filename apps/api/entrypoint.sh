#!/bin/sh
set -e

until node -e "const net=require('net');const s=net.connect(5432,'postgres',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1));"; do
  echo "Esperando postgres..."
  sleep 2
done

pnpm prisma generate
pnpm prisma migrate deploy
pnpm db:seed || true
pnpm dev
