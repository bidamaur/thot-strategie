/**
 * Textes communautaires.
 *
 * La base PostgreSQL est encodée en WIN1252 : un emoji ou un caractère hors de
 * cet alphabet ferait échouer l'écriture. On stocke donc ces caractères sous la
 * forme réversible `&#xHEX;` (et `&` sous la forme `&amp;`), puis on décode à la
 * lecture. Le texte rendu par React reste échappé : aucune injection HTML.
 */

// Caractères WIN1252 situés hors de la plage Latin-1 (0x80–0x9F redéfinis).
const CP1252_EXTRA = new Set(
  "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ".split("").map((c) => c.codePointAt(0)!),
);

function representable(codePoint: number): boolean {
  if (codePoint < 0x80) return true;
  if (codePoint >= 0xa0 && codePoint <= 0xff) return true;
  return CP1252_EXTRA.has(codePoint);
}

export function encodeForDb(text: string): string {
  let out = "";
  for (const char of text) {
    const cp = char.codePointAt(0)!;
    if (char === "&") out += "&amp;";
    else if (representable(cp)) out += char;
    else out += `&#x${cp.toString(16)};`;
  }
  return out;
}

export function decodeFromDb(text: string): string;
export function decodeFromDb(text: string | null): string | null;
export function decodeFromDb(text: string | null): string | null {
  if (text === null) return null;
  return text.replace(/&#x([0-9a-f]{1,6});|&amp;/g, (match, hex: string | undefined) => {
    if (!hex) return "&";
    const cp = Number.parseInt(hex, 16);
    return cp <= 0x10ffff ? String.fromCodePoint(cp) : match;
  });
}

/**
 * Nettoie une saisie : supprime les caractères de contrôle (sauf retours à la ligne),
 * limite les lignes vides consécutives et les espaces de bord.
 */
export function cleanText(input: unknown, maxLength: number): string {
  if (typeof input !== "string") return "";
  const cleaned = input
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁦-⁩]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  // Découpe par caractère (et non par unité UTF-16) pour ne jamais couper un emoji en deux.
  return [...cleaned].slice(0, maxLength).join("").trim();
}

/** Longueur perçue (un emoji compte pour un caractère). */
export function visibleLength(text: string): number {
  return [...text].length;
}

/** Encode en tronquant proprement pour tenir dans une colonne de `max` caractères. */
export function encodeBounded(text: string, max: number): string {
  let out = "";
  for (const char of text) {
    const encoded = encodeForDb(char);
    if (out.length + encoded.length > max) break;
    out += encoded;
  }
  return out;
}
