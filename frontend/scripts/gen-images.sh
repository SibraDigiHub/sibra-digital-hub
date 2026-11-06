#!/bin/bash
# Batch product image generation for Atharva Digital Labs
cd "$(dirname "$0")/.."
OUT=public/images/products
mkdir -p $OUT

gen() {
  local prompt="$1"; local out="$2"
  if [ -s "$OUT/$out.png" ]; then echo "skip $out"; return; fi
  for i in 1 2 3; do
    z-ai image -p "$prompt" -o "$OUT/$out.png" -s 1024x1024 >/dev/null 2>&1 && { echo "OK $out"; return; }
    sleep 2
  done
  echo "FAIL $out"
}

gen "Cute children's coloring book cover illustration, adorable baby animals elephant bunny lion with thick bold outlines, joyful pastel colors, crayon style, warm cream background, kids activity book, high quality" "kids-coloring" &
gen "Children's activity puzzle book cover, friendly cartoon dinosaurs, colorful maze and dot-to-dot elements, playful bright colors, fun education illustration, high quality" "kids-puzzle" &
gen "Kids phonics storybook cover, cute child character reading with magical floating letters ABC, dreamy starry sky, warm storybook illustration style, joyful colors, high quality" "kids-story" &
gen "Preschool numbers counting workbook cover, cheerful numbers 123 characters with smiling faces, tracing dotted lines, soft pastel rainbow colors, education illustration, high quality" "kids-tracing" &
gen "Printable flashcards for kids, cute apple ball cat illustrations on card deck, scissors and craft paper, bright playful colors, flat illustration style, high quality" "kids-flashcards" &
gen "Gentle family routine guide cover, calm parent and child reading together in cozy morning light, soft warm amber tones, mindful peaceful illustration, high quality" "kids-guide" &
gen "Joyful magical kids learning wonderland, floating books stars and rainbow clouds, warm golden pastel palette, whimsical 3D clay render style, dreamy soft lighting, high quality" "kids-hero" &
gen "Premium Canva social media template pack showcase, sleek instagram post layouts grid, modern gradient mockup design, professional marketing aesthetic, high quality" "creator-canva" &
gen "AI prompt engineering digital pack cover, glowing neural network orb with code particles, cinematic prompt cards floating, dark futuristic cyan and magenta neon aesthetic, high quality" "creator-prompts" &
gen "Motion graphics transitions overlay pack showcase, dynamic 4K video editing timeline with glowing light sweeps and glitch effects, dark studio aesthetic, neon accents, high quality" "creator-motion" &
gen "Automation scripts code bundle cover, floating terminal windows with glowing script code, workflow node connections, dark cyberpunk developer aesthetic, green and cyan glow, high quality" "creator-scripts" &
gen "Website UI kit design system showcase, sleek dashboard and portfolio page mockups floating in dark space, wireframe to pixel-perfect transition, cyan purple glow, high quality" "creator-ui" &
gen "Professional ATS resume template pack showcase, clean modern CV documents fanned out, minimal elegant typography, subtle gold accents on dark background, premium design, high quality" "creator-resume" &
gen "Futuristic digital creator assets hub, neon grid horizon with floating holographic product cards, cyberpunk cyan pink violet glow, dark obsidian background, high quality" "creator-hero" &

wait
echo "=== DONE. Generated files: ==="
ls -la $OUT/
