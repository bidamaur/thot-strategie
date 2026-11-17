import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { compressImage, detectImageType } from "@/lib/uploads";
import { isValidKey, keyFromUrl, publicUrl } from "./index";
import { sha256Hex, signV4 } from "./s3-signer";

describe("signature S3 (AWS Signature V4)", () => {
  it("reproduit l'exemple officiel AWS « GET Object »", () => {
    const { signature } = signV4({
      method: "GET",
      path: "/test.txt",
      headers: {
        host: "examplebucket.s3.amazonaws.com",
        range: "bytes=0-9",
        "x-amz-content-sha256": sha256Hex(""),
        "x-amz-date": "20130524T000000Z",
      },
      payloadHash: sha256Hex(""),
      region: "us-east-1",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      amzDate: "20130524T000000Z",
    });
    expect(signature).toBe("f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
  });
});

describe("adresses des fichiers", () => {
  const fs = { driver: "filesystem" as const, fsRoot: "storage/uploads", publicBaseUrl: "", s3: { endpoint: "", bucket: "", region: "", accessKeyId: "", secretAccessKey: "" } };
  const s3 = { ...fs, driver: "s3" as const, s3: { ...fs.s3, endpoint: "https://s3.example.com", bucket: "thot" } };
  const cdn = { ...s3, publicBaseUrl: "https://images.thot.cm" };
  const key = "community/abc123_0123456789abcdef01.webp";

  it("adresse publique selon l'emplacement", () => {
    expect(publicUrl(fs, key)).toBe(`/media/${key}`);
    expect(publicUrl(s3, key)).toBe(`https://s3.example.com/thot/${key}`);
    expect(publicUrl(cdn, key)).toBe(`https://images.thot.cm/${key}`);
  });
  it("retrouve la clé et refuse les adresses étrangères ou piégées", () => {
    expect(keyFromUrl(cdn, `https://images.thot.cm/${key}`)).toBe(key);
    expect(keyFromUrl(fs, `/media/${key}`)).toBe(key);
    expect(keyFromUrl(fs, `https://ailleurs.com/${key}`)).toBeNull();
    expect(keyFromUrl(fs, "/media/community/../../.env")).toBeNull();
    expect(isValidKey("avatars/x.html")).toBe(false);
  });
});

describe("compression des images", () => {
  it("convertit en WebP redimensionné, bien plus léger, sans métadonnées", async () => {
    // Image de type photo 3000×2000 (dégradés + grain) envoyée en PNG.
    const width = 3000;
    const height = 2000;
    const raw = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 3;
        const grain = ((x * 31 + y * 17) % 9) - 4;
        raw[i] = 128 + 90 * Math.sin(x / 140) + grain;
        raw[i + 1] = 128 + 90 * Math.cos(y / 110) + grain;
        raw[i + 2] = 128 + 60 * Math.sin((x + y) / 200) + grain;
      }
    }
    const png = await sharp(raw, { raw: { width, height, channels: 3 } }).withMetadata({ exif: { IFD0: { Copyright: "secret" } } }).png().toBuffer();
    const { buffer, width: w, height: h } = await compressImage(png, { maxDimension: 1600, quality: 68 });
    expect(detectImageType(buffer)).toBe("webp");
    expect(Math.max(w, h)).toBe(1600);
    expect(buffer.length).toBeLessThan(png.length / 3);
    const meta = await sharp(buffer).metadata();
    expect(meta.exif).toBeUndefined();
  });

  it("avatar : recadré en carré à la taille demandée", async () => {
    const img = await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#336699" } }).jpeg().toBuffer();
    const { width, height } = await compressImage(img, { maxDimension: 256, quality: 68, square: true });
    expect([width, height]).toEqual([256, 256]);
  });

  it("refuse un fichier endommagé", async () => {
    const broken = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("pas une image")]);
    await expect(compressImage(broken, { maxDimension: 100, quality: 60 })).rejects.toThrow();
  });
});
