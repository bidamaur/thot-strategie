import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { prisma } from "@/lib/prisma";

const scryptAsync = promisify(scrypt);
export const SESSION_COOKIE_NAME = "thot_session";
export const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

const profileSelect = {
  id: true,
  username: true,
  isAdmin: true,
  isPremium: true,
  pointsFree: true,
  walletReal: true,
  elo: true,
  draughtsVariant: true,
  country: true,
  city: true,
  neighborhood: true,
  avatar: true,
} as const;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  storedHash: string | null,
): Promise<boolean> {
  if (!storedHash) return false;
  const [algorithm, saltHex, keyHex] = storedHash.split("$");
  if (
    algorithm !== "scrypt" ||
    !saltHex ||
    !keyHex ||
    !/^[a-f0-9]{32}$/i.test(saltHex) ||
    !/^[a-f0-9]{128}$/i.test(keyHex)
  ) {
    return false;
  }

  const expected = Buffer.from(keyHex, "hex");
  const actual = (await scryptAsync(
    password,
    Buffer.from(saltHex, "hex"),
    expected.length,
  )) as Buffer;
  return timingSafeEqual(actual, expected);
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createUserSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await prisma.userSession.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
    },
  });
  return token;
}

export function readSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const prefix = `${SESSION_COOKIE_NAME}=`;
  const cookie = cookieHeader
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefix));
  return cookie?.slice(prefix.length) || null;
}

export async function getSessionUserByToken(token: string | null) {
  if (!token || token.length > 128) return null;
  const session = await prisma.userSession.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    select: {
      user: { select: profileSelect },
      expiresAt: true,
    },
  });
  if (!session) return null;
  if (session.expiresAt <= new Date()) {
    await prisma.userSession.delete({ where: { tokenHash: hashSessionToken(token) } });
    return null;
  }
  return session.user;
}

export async function getRequestUser(request: Request) {
  return getSessionUserByToken(readSessionCookie(request.headers.get("cookie")));
}

export function toPublicProfile(user: {
  id: string;
  username: string;
  isAdmin: boolean;
  isPremium: boolean;
  pointsFree: number;
  walletReal: { toString(): string };
  elo: number;
  draughtsVariant: string;
  country: string | null;
  city: string | null;
  neighborhood: string | null;
  avatar?: string | null;
}) {
  return {
    id: user.id,
    username: user.username,
    isAdmin: user.isAdmin,
    isPremium: user.isPremium,
    pointsFree: user.pointsFree,
    walletReal: user.walletReal.toString(),
    elo: user.elo,
    draughtsVariant: user.draughtsVariant,
    country: user.country,
    city: user.city,
    neighborhood: user.neighborhood,
    avatar: user.avatar ?? null,
  };
}
