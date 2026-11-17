import { describe, expect, it } from "vitest";
import { detectImageType } from "@/lib/uploads";
import { pairKey } from "./friends";
import { DEFAULT_PRIVACY, readPrivacy } from "./profile";
import { cleanText, decodeFromDb, encodeBounded, encodeForDb } from "./text";

describe("textes communautaires (base WIN1252)", () => {
  it("encode puis décode sans perte emojis, symboles et entités littérales", () => {
    for (const sample of ["Bravo 🎉", "♞ contre ⛀", "« Été » — œuvre €", "a & b", "&#x41; reste littéral", "&amp; aussi", "👨‍👩‍👧 famille"]) {
      expect(decodeFromDb(encodeForDb(sample))).toBe(sample);
    }
  });

  it("le texte encodé ne contient que des caractères WIN1252", () => {
    const encoded = encodeForDb("Échec et mat ♚ 🏆");
    expect(() => Buffer.from(encoded, "latin1").toString("latin1")).not.toThrow();
    expect([...encoded].every((c) => c.codePointAt(0)! < 0x2200)).toBe(true);
  });

  it("tronque proprement sans couper une séquence encodée", () => {
    const encoded = encodeBounded("ab🎉cd", 8);
    expect(decodeFromDb(encoded)).toBe("ab");
  });

  it("nettoie les caractères de contrôle et ne coupe jamais un emoji", () => {
    expect(cleanText("  salut\u0000‮  ", 50)).toBe("salut");
    expect(cleanText("a\n\n\n\nb", 50)).toBe("a\n\nb");
    expect(cleanText("🎉🎉🎉", 2)).toBe("🎉🎉");
  });
});

describe("amitiés", () => {
  it("une seule clé par paire, quel que soit le sens", () => {
    expect(pairKey("b", "a")).toBe(pairKey("a", "b"));
    expect(pairKey("a", "b")).toBe("a:b");
  });
});

describe("confidentialité", () => {
  it("valeurs par défaut et champs invalides ignorés", () => {
    expect(readPrivacy(null)).toEqual(DEFAULT_PRIVACY);
    expect(readPrivacy({ showRatings: false, friendRequests: "NOBODY", accent: "javascript:alert(1)" })).toMatchObject({
      showRatings: false,
      friendRequests: "NOBODY",
      accent: null,
    });
  });
});

describe("téléversement d'images", () => {
  it("reconnaît le type réel et refuse un faux fichier image", () => {
    expect(detectImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))).toBe("png");
    expect(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe("jpg");
    expect(detectImageType(Buffer.from("<html><script>alert(1)</script></html>"))).toBeNull();
  });
});
