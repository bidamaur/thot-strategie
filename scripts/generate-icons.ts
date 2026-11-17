/**
 * Génère les icônes de l'application installable à partir d'un dessin
 * vectoriel unique (pion de dames frappé d'un « T », couleurs de la charte).
 *   npx tsx scripts/generate-icons.ts
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const OUT = path.join(process.cwd(), "public", "icons");

/** `inset` : marge de sécurité (les icônes « maskable » sont rognées en cercle ou en goutte). */
function svg(size: number, { rounded, inset }: { rounded: boolean; inset: number }) {
  const r = rounded ? size * 0.22 : 0;
  const c = size / 2;
  const disc = (size / 2) * (1 - inset);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1a2420"/>
      <stop offset="1" stop-color="#0f1513"/>
    </linearGradient>
    <radialGradient id="piece" cx="0.4" cy="0.35" r="0.75">
      <stop offset="0" stop-color="#a5d8be"/>
      <stop offset="1" stop-color="#5f9d80"/>
    </radialGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${r}" fill="url(#bg)"/>
  <circle cx="${c}" cy="${c + disc * 0.06}" r="${disc}" fill="#13221c"/>
  <circle cx="${c}" cy="${c}" r="${disc}" fill="url(#piece)"/>
  <circle cx="${c}" cy="${c}" r="${disc * 0.78}" fill="none" stroke="#0d1a14" stroke-opacity="0.35" stroke-width="${disc * 0.05}"/>
  <circle cx="${c}" cy="${c}" r="${disc * 0.56}" fill="none" stroke="#0d1a14" stroke-opacity="0.25" stroke-width="${disc * 0.04}"/>
  <path d="M ${c - disc * 0.42} ${c - disc * 0.36} H ${c + disc * 0.42} V ${c - disc * 0.16} H ${c + disc * 0.11} V ${c + disc * 0.46} H ${c - disc * 0.11} V ${c - disc * 0.16} H ${c - disc * 0.42} Z" fill="#0d1a14"/>
</svg>`;
}

async function render(file: string, size: number, opts: { rounded: boolean; inset: number }) {
  await sharp(Buffer.from(svg(size, opts))).png({ compressionLevel: 9 }).toFile(path.join(OUT, file));
  console.log("✓", file);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await render("icon-192.png", 192, { rounded: true, inset: 0.18 });
  await render("icon-512.png", 512, { rounded: true, inset: 0.18 });
  // Maskable : fond plein, motif dans la zone sûre centrale (≈ 80 %).
  await render("maskable-512.png", 512, { rounded: false, inset: 0.34 });
  await render("maskable-192.png", 192, { rounded: false, inset: 0.34 });
  // iOS applique ses propres coins arrondis : fond plein.
  await render("apple-touch-icon.png", 180, { rounded: false, inset: 0.2 });
}

void main();
