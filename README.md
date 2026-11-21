# Expediente Rosa

Expediente digital por paciente para jornadas de tamizaje en comunidades sin señal (reto 1 de EIRA Movimiento Rosa, Nerdearla Vibeathon MX 2026). Funciona hasta 3 días sin internet, reconoce a una paciente que regresa aunque su nombre esté escrito distinto y sincroniza al volver la señal.

Solo usa datos ficticios.

## Cómo levantarlo

Requisitos: Node 20, pnpm, Docker.

```bash
docker compose up -d          # Valkey
cd api && pnpm install && pnpm dev   # API en :8787
cd app && pnpm install && pnpm dev   # App en :5173
```

## Credenciales

Ninguna para correrlo local. Copia `.env.example` a `.env` en `api/`.

## Licencia

MIT
