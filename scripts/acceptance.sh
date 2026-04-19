#!/usr/bin/env bash
set -euo pipefail

npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
npm run test:eval

if [[ -n "${OPENAI_API_KEY:-}" && -n "${DUFFEL_API_TOKEN:-}" && -n "${EXPEDIA_RAPID_API_KEY:-}" && -n "${EXPEDIA_RAPID_SHARED_SECRET:-}" && -n "${POSTGRES_URL:-}" ]]; then
  echo "[acceptance] Running live API CLI scenario"
  npm run dev -- --cli --thread-id acceptance-live --request "Plan a 3-day trip with real flights/hotels/weather" --origin SFO --destination-hint Tokyo --destination-city TYO --destination-iata HND --start-date 2026-09-10 --end-date 2026-09-12 --budget 2400 --adults 1 --children 0 --interests food,museums
else
  echo "[blocked] Live API acceptance requires OPENAI_API_KEY + DUFFEL_API_TOKEN + EXPEDIA_RAPID_API_KEY + EXPEDIA_RAPID_SHARED_SECRET + POSTGRES_URL"
fi
