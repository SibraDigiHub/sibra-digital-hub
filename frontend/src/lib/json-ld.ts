// T7 (§8.5): JSON-LD output escaping.
//
// JSON.stringify does NOT escape `<`. Any admin-authored string that ends
// up inside a JSON-LD block (product title/description, FAQ answer…) could
// therefore contain `</script>` and break out of the embedding
// <script type="application/ld+json"> tag — a stored-XSS vector.
//
// Escaping `<` as the JSON escape sequence \u003c is semantically
// identical JSON (parsers decode it back to `<`) but can never terminate
// a <script> element.
export function jsonLdString(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}
