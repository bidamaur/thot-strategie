import { getRequestUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const MAX_FILE_SIZE = 2 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const AVATAR_DIR = path.join(process.cwd(), "public", "avatars");

export async function POST(request: Request): Promise<NextResponse> {
  const currentUser = await getRequestUser(request);
  if (!currentUser) {
    return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Le corps de la requête doit être un formulaire multipart." },
      { status: 400 },
    );
  }

  const file = formData.get("avatar");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json(
      { error: "Aucune image fournie." },
      { status: 400 },
    );
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: "Format d'image non supporté (JPEG, PNG, WEBP, GIF)." },
      { status: 400 },
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: "L'image ne doit pas dépasser 2 Mo." },
      { status: 400 },
    );
  }

  try {
    await mkdir(AVATAR_DIR, { recursive: true });
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const ext = file.name.split(".").pop() ?? "png";
    const fileName = `avatar_${currentUser.id}_${Date.now()}.${ext}`;
    const filePath = path.join(AVATAR_DIR, fileName);
    await writeFile(filePath, buffer);

    const avatarUrl = `/avatars/${fileName}`;

    const user = await prisma.user.update({
      where: { id: currentUser.id },
      data: { avatar: avatarUrl },
      select: { id: true, avatar: true },
    });

    return NextResponse.json({ user, avatarUrl });
  } catch (error) {
    console.error("Erreur lors de l'upload de l'avatar :", error);
    return NextResponse.json(
      { error: "Impossible d'uploader l'avatar." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const currentUser = await getRequestUser(request);
  if (!currentUser) {
    return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  }

  try {
    await prisma.user.update({
      where: { id: currentUser.id },
      data: { avatar: null },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Erreur lors de la suppression de l'avatar :", error);
    return NextResponse.json(
      { error: "Impossible de supprimer l'avatar." },
      { status: 500 },
    );
  }
}
