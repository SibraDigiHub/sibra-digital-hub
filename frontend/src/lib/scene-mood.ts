export function resolveSceneMood(
  view: string,
  zone: 'kids' | 'creator' | null | undefined,
  previewMood: number,
): number {
  if (view === 'shop' || view === 'product') {
    return zone === 'creator' ? 1 : zone === 'kids' ? 0 : 0.5
  }
  return previewMood
}
