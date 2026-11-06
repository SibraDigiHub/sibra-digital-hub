#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# check-react-keys.sh — React duplicate-key regression guard.
#
# Opens the main views of the running app (dev build or any other
# build) in a headless Chromium via `agent-browser` and FAILS with
# a non-zero exit code if React logs a "two children with the same
# key" / "unique key" warning to console.error.
#
# Passes:
#   1. Main views — gateway, Kids shop, Creator shop, product page,
#      checkout dialog, legal pages (privacy / terms / refund-policy /
#      contact) and the admin login.
#   2. Reviews-marquee FALLBACK path (the original bug): /api/reviews
#      is aborted so ReviewsCarousel renders its 4 built-in samples,
#      which previously triggered the loop-fill duplicate keys
#      (`fb-kids-1` … `ghost-fb-kids-2`).
#   3. Marquee seam check — for every marquee track on the two shop
#      views, both loop copies must have identical content and width,
#      which is what makes the CSS 50%-translate loop seamless.
#
# Usage:  scripts/check-react-keys.sh [BASE_URL]
#         (default BASE_URL = http://localhost:3000)
# ═══════════════════════════════════════════════════════════
set -u

BASE="${1:-http://localhost:3000}"
AB="agent-browser"
TMO="--timeout 90000"
FAIL=0
PASS_N=0
FAIL_N=0

log() { printf '%s\n' "$*"; }

# ── helpers ──────────────────────────────────────────────────
console_key_warnings() {
  # Print only React key warnings from the captured browser console.
  $AB console 2>/dev/null | grep -Ei "same key|unique key"
}

open_and_settle() { # $1 url
  $AB console --clear >/dev/null 2>&1
  $AB open "$1" $TMO >/dev/null 2>&1
  $AB wait --load networkidle $TMO >/dev/null 2>&1
  sleep 2 # let async fetches settle and React flush warnings
}

check_view() { # $1 label  $2 url
  local label="$1" url="$2" hits
  open_and_settle "$url"
  hits=$(console_key_warnings)
  if [ -n "$hits" ]; then
    FAIL_N=$((FAIL_N + 1)); FAIL=1
    log "  ✗ $label — REACT KEY WARNING:"
    printf '%s\n' "$hits" | sed 's/^/      /'
  else
    PASS_N=$((PASS_N + 1))
    log "  ✓ $label — no key warnings"
  fi
}

# ── resolve a real product slug for the product/checkout views ──
# Prefer a product with instantDownload:true — only those render the
# "Instant Download" CTA that opens the checkout dialog.
SLUG=""
# 3 attempts — under a full verify run the first /api/products hit can be a
# cold dev compile; the one-shot fetch used to race it (FINDINGS: verify-only
# flake, standalone 13/13). PRODUCT_SLUG env still overrides.
for _ in 1 2 3; do
  SLUG="$(curl -sf --max-time 30 "$BASE/api/products" 2>/dev/null | python3 -c \
    'import json,sys;d=json.load(sys.stdin);ps=d["products"] if isinstance(d,dict) and "products" in d else d;inst=[p for p in ps if p.get("instantDownload")];print((inst or ps)[0]["slug"])' 2>/dev/null || true)"
  [ -n "$SLUG" ] && break
  sleep 3
done
if [ -z "$SLUG" ]; then SLUG="${PRODUCT_SLUG:-}"; fi

log "── check-react-keys @ $BASE ──────────────────────────────"

# ── Pass 1: main views ───────────────────────────────────────
log "Pass 1 — main views ($BASE):"
check_view "gateway            #/"                     "$BASE/#/"
check_view "Kids shop          #/shop?zone=kids"    "$BASE/#/shop?zone=kids"
check_view "Creator shop       #/shop?zone=creator" "$BASE/#/shop?zone=creator"

if [ -n "$SLUG" ]; then
  check_view "product page      #/product/$SLUG" "$BASE/#/product/$SLUG"

  # Checkout dialog: click the instant-checkout CTA, confirm the
  # dialog actually opened, then look for key warnings.
  open_and_settle "$BASE/#/product/$SLUG"
  $AB console --clear >/dev/null 2>&1
  CLICKED="$($AB eval '(()=>{const b=document.querySelector("button[aria-label^="+JSON.stringify("Instant Download for ")+"]");if(!b)return "NO_BUTTON";b.click();return "CLICKED";})()' 2>/dev/null)"
  sleep 2
  DIALOG="$($AB eval '(()=>{const d=document.querySelector("[role=dialog]");return d?"OPEN":"NOT_OPEN";})()' 2>/dev/null)"
  # agent-browser eval returns JSON-quoted strings — strip the quotes.
  CLICKED="${CLICKED//\"/}"
  DIALOG="${DIALOG//\"/}"
  hits="$(console_key_warnings)"
  if [ "$CLICKED" != "CLICKED" ] || [ "$DIALOG" != "OPEN" ]; then
    FAIL_N=$((FAIL_N + 1)); FAIL=1
    log "  ✗ checkout dialog — could not open (click=$CLICKED dialog=$DIALOG)"
  elif [ -n "$hits" ]; then
    FAIL_N=$((FAIL_N + 1)); FAIL=1
    log "  ✗ checkout dialog — REACT KEY WARNING:"
    printf '%s\n' "$hits" | sed 's/^/      /'
  else
    PASS_N=$((PASS_N + 1))
    log "  ✓ checkout dialog — open, no key warnings"
  fi
else
  FAIL_N=$((FAIL_N + 1)); FAIL=1
  log "  ✗ product page / checkout dialog — no product slug available"
fi

check_view "legal: privacy        #/privacy"        "$BASE/#/privacy"
check_view "legal: terms          #/terms"          "$BASE/#/terms"
check_view "legal: refund-policy  #/refund-policy"  "$BASE/#/refund-policy"
check_view "legal: contact        #/contact"        "$BASE/#/contact"
check_view "admin login           #/admin"          "$BASE/#/admin"

# ── Pass 2: reviews fallback path (loop-fill regression) ─────
log "Pass 2 — reviews FALLBACK path (/api/reviews aborted → 4 built-in samples → loop-fill):"
$AB network route "**/api/reviews" --abort >/dev/null 2>&1
check_view "Kids shop + fallback reviews" "$BASE/#/shop?zone=kids&checkkeys=1"
$AB network unroute "**/api/reviews" >/dev/null 2>&1

# ── Pass 3: marquee seam (both copies identical) ─────────────
log "Pass 3 — marquee seam (copy #1 ≡ copy #2 for every track):"
seam_check() { # $1 label  $2 url
  local label="$1" url="$2" out
  open_and_settle "$url"
  out="$($AB eval '(()=>{const tracks=[...document.querySelectorAll(".journey-track,.ticker-track")];if(!tracks.length)return "NO_TRACKS";return tracks.map((t,i)=>{const a=t.children[0],b=t.children[1];if(!a||!b)return "TRACK"+i+":MISSING_COPY";const same=a.textContent===b.textContent;const w1=Math.round(a.getBoundingClientRect().width),w2=Math.round(b.getBoundingClientRect().width);return "TRACK"+i+":"+(same&&w1===w2?"SEAMLESS(w="+w1+")":"MISMATCH(w="+w1+" vs "+w2+")")}).join(" ")})()' 2>/dev/null)"
  if printf '%s' "$out" | grep -q "SEAMLESS" && ! printf '%s' "$out" | grep -qE "MISMATCH|MISSING|NO_TRACKS"; then
    PASS_N=$((PASS_N + 1))
    log "  ✓ $label — $out"
  else
    FAIL_N=$((FAIL_N + 1)); FAIL=1
    log "  ✗ $label — $out"
  fi
}
seam_check "Kids shop marquees"    "$BASE/#/shop?zone=kids"
seam_check "Creator shop marquees" "$BASE/#/shop?zone=creator"

# ── summary ──────────────────────────────────────────────────
log "──────────────────────────────────────────────────────────"
log "Result: $PASS_N passed, $FAIL_N failed — exit $FAIL"
log "──────────────────────────────────────────────────────────"
exit "$FAIL"
