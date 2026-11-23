/**
 * Banc d'essai : chaque niveau de l'IA affronte le niveau inférieur aux dames
 * anglaises 8×8 (couleurs alternées). Fin de partie : plus de coup légal, ou
 * arbitrage au matériel (dame = 3 pions) après la limite de coups.
 * Lancement : npx tsx scripts/bench-ai-levels.ts [parties par duel]
 */
import { applyDraughtsMove, chooseDraughtsMove, createDraughtsPosition, getLegalDraughtsMoves, type DraughtsPosition } from "@/lib/engine/draughts";
import type { Difficulty } from "@/lib/engine/game-settings";

const GAMES = Number(process.argv[2] ?? 8);
const MAX_PLIES = 160;

function material(p: DraughtsPosition, color: "w" | "b") {
  let n = 0;
  for (const row of p.board) for (const piece of row) if (piece && piece.color === color) n += piece.king ? 3 : 1;
  return n;
}

/** Résultat du point de vue des blancs : 1, 0,5 ou 0. */
function play(white: Difficulty, black: Difficulty): number {
  let p = createDraughtsPosition("ENGLISH");
  for (let ply = 0; ply < MAX_PLIES; ply += 1) {
    if (getLegalDraughtsMoves(p).length === 0) return p.turn === "w" ? 0 : 1;
    const move = chooseDraughtsMove(p, p.turn === "w" ? white : black);
    if (!move) return p.turn === "w" ? 0 : 1;
    p = applyDraughtsMove(p, move);
  }
  const diff = material(p, "w") - material(p, "b");
  return diff > 1 ? 1 : diff < -1 ? 0 : 0.5;
}

for (let level = 2; level <= 5; level += 1) {
  const strong = level as Difficulty;
  const weak = (level - 1) as Difficulty;
  let score = 0;
  const t0 = Date.now();
  for (let g = 0; g < GAMES; g += 1) {
    score += g % 2 === 0 ? play(strong, weak) : 1 - play(weak, strong);
  }
  console.log(`Niveau ${strong} contre niveau ${weak} : ${score}/${GAMES} (${Math.round((score / GAMES) * 100)} %) en ${Math.round((Date.now() - t0) / 1000)} s`);
}
