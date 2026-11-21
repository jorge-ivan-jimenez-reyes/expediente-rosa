#!/usr/bin/env bash
# Deja la demo en su punto de partida: borra lo del ensayo, recarga las pacientes ficticias,
# programa las 3 jornadas y (con --app) reinstala la app limpia en el simulador.
#   scripts/demo-reset.sh          # solo servidor
#   scripts/demo-reset.sh --app    # servidor + app del simulador
set -euo pipefail
cd "$(dirname "$0")/.."
API=${API_URL:-http://localhost:8787/api}
SIM=${SIM:-F7DE1147-312D-4C65-9299-567C648FB7A9}

echo "1/5 Valkey: borrando datos del ensayo"
docker exec eira-expediente-valkey-1 valkey-cli FLUSHDB >/dev/null

echo "2/5 API: reiniciando"
if docker ps --format '{{.Names}}' | grep -q '^eira-expediente-api-1$'; then
  docker restart eira-expediente-api-1 >/dev/null
else
  pkill -f "tsx src/index.ts" 2>/dev/null || true
  sleep 1
  # Sin heredar stdin/stdout del script: si no, el script se queda esperando a la API.
  (cd api && PORT=8787 nohup npx tsx src/index.ts </dev/null >/tmp/eira-api.log 2>&1 & disown) </dev/null >/dev/null 2>&1
fi
for _ in $(seq 1 40); do curl -sf "$API/salud" >/dev/null && break; sleep 0.5; done
curl -sf "$API/salud" >/dev/null || { echo "La API no respondió; revisa /tmp/eira-api.log"; exit 1; }

echo "3/5 Cargando las pacientes ficticias"
(cd api && API_URL="$API" pnpm -s seed >/dev/null)

echo "4/5 Programando jornadas"
# San Martín Peras se programa en vivo durante la demo.
for x in "Huejuquilla|Jalisco|2026-12-02" "Metlatónoc|Guerrero|2026-12-09"; do
  IFS='|' read -r c e f <<< "$x"
  curl -sf -X POST "$API/jornadas" -H 'content-type: application/json' \
    -d "{\"comunidad\":\"$c\",\"estado\":\"$e\",\"fecha\":\"$f\",\"autor\":\"Coordinación EIRA\"}" >/dev/null
done

if [[ "${1:-}" == "--app" ]]; then
  echo "5/5 Simulador: reinstalando la app limpia"
  APP=ios/build/dd-esqueleto/Build/Products/Debug-iphonesimulator/ExpedienteRosa.app
  xcrun simctl terminate "$SIM" org.eira.expedienterosa 2>/dev/null || true
  xcrun simctl uninstall "$SIM" org.eira.expedienterosa 2>/dev/null || true
  xcrun simctl install "$SIM" "$APP"
  xcrun simctl addmedia "$SIM" docs/hojas-ejemplo/*.jpg
else
  echo "5/5 (app sin tocar; usa --app para reinstalarla)"
fi

curl -s "$API/resumen" | python3 -c "import json,sys;d=json.load(sys.stdin);print('Listo:',d['personasUnicas'],'personas,',d['estudios']['total'],'estudios,',d['pendientesPatologia'],'papanicolaous en laboratorio')"
curl -s "$API/jornadas" | python3 -c "import json,sys;[print('  jornada',j['fecha'],j['comunidad'],'·',j['pacientesPrevias'],'pacientes') for j in json.load(sys.stdin)]"
