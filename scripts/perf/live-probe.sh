#!/usr/bin/env bash
# Read-only production latency probe. GET only; no cookies, auth, writes, or secrets.
# Usage: FRONTEND_URL=https://www.example.com PRODUCT_PATH=/product/real-slug ./scripts/perf/live-probe.sh
# PRODUCT_SLUG is derived from PRODUCT_PATH unless explicitly supplied.
# Optional: BACKEND_URL=https://api.example.com (direct backend GETs are appended).
set -Eeuo pipefail

: "${FRONTEND_URL:?Set FRONTEND_URL to the public HTTPS site origin}"
FRONTEND_URL="${FRONTEND_URL%/}"
PRODUCT_PATH="${PRODUCT_PATH:-/product/replace-with-real-slug}"
PRODUCT_SLUG="${PRODUCT_SLUG:-${PRODUCT_PATH##*/}}"
RUNS="${RUNS:-5}"
TIMEOUT="${TIMEOUT:-30}"

if [[ ! "$FRONTEND_URL" =~ ^https:// ]]; then
  echo "ERROR: FRONTEND_URL must be a public HTTPS origin." >&2
  exit 2
fi
if ! [[ "$RUNS" =~ ^[0-9]+$ ]] || (( RUNS < 1 || RUNS > 20 )); then
  echo "ERROR: RUNS must be an integer from 1 to 20." >&2
  exit 2
fi
if [[ "$PRODUCT_PATH" != /* ]]; then
  echo "ERROR: PRODUCT_PATH must begin with /." >&2
  exit 2
fi
if [[ ! "$PRODUCT_SLUG" =~ ^[A-Za-z0-9_-]+$ ]]; then
  echo "ERROR: PRODUCT_SLUG must contain only letters, numbers, underscores or hyphens." >&2
  exit 2
fi
if [[ -n "${BACKEND_URL:-}" && ! "$BACKEND_URL" =~ ^https:// && ! "$BACKEND_URL" =~ ^http://(127\.0\.0\.1|localhost|\[::1\])(:[0-9]+)?$ ]]; then
  echo "ERROR: BACKEND_URL must be HTTPS, or HTTP on loopback only." >&2
  exit 2
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# Keep this list read-only and public. The checkout quote endpoint is POST-only
# and is deliberately excluded; measure the dialog in mock mode via the runbook.
PATHS=(
  "/"
  "/shop"
  "/shop?zone=kids"
  "/shop?zone=creator"
  "$PRODUCT_PATH"
  "/privacy"
  "/terms"
  "/contact"
  "/api/products?slug=${PRODUCT_SLUG}"
  "/api/products"
  "/api/categories"
  "/api/settings"
  "/api/reviews"
  "/api/faqs"
  "/api/geo"
  "/api/channels?zone=kids"
  "/api/channels?zone=creator"
)

header_value() {
  local file="$1" name="$2"
  awk -v wanted="${name,,}" 'tolower($0) ~ "^" wanted ":" {sub(/^[^:]*:[[:space:]]*/, ""); gsub(/\r/, ""); value=$0} END{if(value!="") print value; else print "-"}' "$file"
}
percentile() {
  local file="$1" pct="$2"
  sort -n "$file" | awk -v p="$pct" '{a[NR]=$1} END {if(NR){i=int((p*NR+99)/100); if(i<1)i=1; print a[i]} else print "-"}'
}

probe_group() {
  local label="$1" base="$2" path="$3" url
  local totals="$TMP_DIR/totals.$RANDOM" i headers metrics status dns connect tls ttfb total bytes
  url="${base}${path}"
  : > "$totals"
  printf '\n[%s] %s\n' "$label" "$url"
  printf 'run\tstatus\tdns_ms\tconnect_ms\ttls_ms\tttfb_ms\ttotal_ms\tbytes\tencoding\tcache_control\tage\tvercel_cache\tvercel_id\tserver_timing\n'
  for ((i=1; i<=RUNS; i++)); do
    headers="$TMP_DIR/headers.$RANDOM"
    metrics="$TMP_DIR/metrics.$RANDOM"
    local -a curl_args=(--silent --show-error --location --proto '=https,http' --proto-redir '=https' --max-time "$TIMEOUT")
    if [[ "$label" == "backend" && -n "${BACKEND_INTERNAL_KEY:-}" ]]; then
      curl_args+=(--header "x-internal-key: ${BACKEND_INTERNAL_KEY}")
    fi
    if ! curl "${curl_args[@]}" --output /dev/null --dump-header "$headers" \
      --write-out '%{http_code}\t%{time_namelookup}\t%{time_connect}\t%{time_appconnect}\t%{time_starttransfer}\t%{time_total}\t%{size_download}\n' \
      "$url" > "$metrics"; then
      printf '%s\tCURL_ERROR\t-\t-\t-\t-\t-\t-\t-\t-\t-\t-\t-\t-\n' "$i"
      continue
    fi
    IFS=$'\t' read -r status dns_s connect_s appconnect_s ttfb_s total_s bytes < "$metrics"
    dns="$(awk -v x="$dns_s" 'BEGIN{printf "%.1f",x*1000}')"
    connect="$(awk -v x="$connect_s" -v d="$dns_s" 'BEGIN{printf "%.1f",(x-d)*1000}')"
    tls="$(awk -v x="$appconnect_s" -v c="$connect_s" 'BEGIN{printf "%.1f",(x-c)*1000}')"
    ttfb="$(awk -v x="$ttfb_s" 'BEGIN{printf "%.1f",x*1000}')"
    total="$(awk -v x="$total_s" 'BEGIN{printf "%.1f",x*1000}')"
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
      "$i" "$status" "$dns" "$connect" "$tls" "$ttfb" "$total" "$bytes" \
      "$(header_value "$headers" content-encoding)" \
      "$(header_value "$headers" cache-control)" \
      "$(header_value "$headers" age)" \
      "$(header_value "$headers" x-vercel-cache)" \
      "$(header_value "$headers" x-vercel-id)" \
      "$(header_value "$headers" server-timing)"
    printf '%s\n' "$total" >> "$totals"
    rm -f "$headers" "$metrics"
  done
  printf 'SUMMARY\tp50_total_ms=%s\tp95_total_ms=%s\n' \
    "$(percentile "$totals" 50)" "$(percentile "$totals" 95)"
}

printf 'Sibra read-only live probe | runs=%s | frontend=%s | product_slug=%s\n' "$RUNS" "$FRONTEND_URL" "$PRODUCT_SLUG"
printf 'Timestamp (UTC): %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
for path in "${PATHS[@]}"; do
  probe_group frontend "$FRONTEND_URL" "$path"
done

if [[ -n "${BACKEND_URL:-}" ]]; then
  BACKEND_URL="${BACKEND_URL%/}"
  printf '\n=== Direct backend measurements (only if public GET access is intentionally enabled) ===\n'
  BACKEND_PATHS=(
    "/api/products?slug=${PRODUCT_SLUG}" "/api/products" "/api/categories" "/api/settings" "/api/reviews"
    "/api/faqs" "/api/geo" "/api/channels?zone=kids" "/api/channels?zone=creator"
  )
  for path in "${BACKEND_PATHS[@]}"; do
    probe_group backend "$BACKEND_URL" "$path"
  done
fi
