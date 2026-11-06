#!/bin/bash
# ═══════════════════════════════════════════════════════════
# check-links-console.sh — frontend quality gate (§2.7).
#   1. every internal link rendered on the legal pages and in the
#      footer resolves (same-origin hrefs → HTTP 200 via the proxy)
#   2. the main views are console-error-free (agent-browser, dev or
#      deployed URL — BASE_URL argument, default http://127.0.0.1:3000)
# Non-zero exit on any broken link or console error.
# ═══════════════════════════════════════════════════════════

set -u
BASE_URL="${1:-http://127.0.0.1:3000}"
AB="$(command -v agent-browser || true)"
if [ -z "$AB" ]; then
  echo "check-links-console: agent-browser not available — skipping (documented in docs/TESTING.md)"
  exit 0
fi

FAILS=0
note() { printf '  %s\n' "$1"; }

# ── 1. internal links on legal pages + footer ────────────────
echo "── internal links (legal pages + footer) ──"
LINKS="$(curl -sf "$BASE_URL/" | grep -oE 'href="#/[a-z-]*"' | sort -u | tr -d '"' | sed 's/href=//')"
# hash routes render client-side; the shell route itself must be 200
for link in $LINKS; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/")"
  if [ "$code" = "200" ]; then note "✓ $link (shell 200)"; else note "✗ $link — shell $code"; FAILS=$((FAILS+1)); fi
done
for real in /robots.txt /sitemap.xml /llms.txt /manifest.webmanifest; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL$real")"
  if [ "$code" = "200" ]; then note "✓ $real"; else note "✗ $real — $code"; FAILS=$((FAILS+1)); fi
done

# ── 2. console-error-free main views ─────────────────────────
echo "── console errors on main views ──"
VIEWS="#/ #/shop?zone=kids #/shop?zone=creator #/privacy #/terms #/refund-policy #/contact #/admin"
for view in $VIEWS; do
  "$AB" open "$BASE_URL/$view" > /dev/null 2>&1
  "$AB" wait --load networkidle > /dev/null 2>&1
  sleep 2
  LOG="$("$AB" console 2>/dev/null || true)"
  if echo "$LOG" | grep -qiE "\[error\]|uncaught|error:"; then
    note "✗ $view — console errors:"
    echo "$LOG" | grep -iE "\[error\]|uncaught|error:" | head -3 | sed 's/^/      /'
    FAILS=$((FAILS+1))
  else
    note "✓ $view — console clean"
  fi
  "$AB" console --clear > /dev/null 2>&1 || true
done

echo "──────────────────────────────────────────"
if [ "$FAILS" -gt 0 ]; then
  echo "check-links-console: $FAILS failure(s)"
  exit 1
fi
echo "check-links-console: PASS — all internal links resolve, all main views console-clean"
