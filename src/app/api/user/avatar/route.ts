import { getRequestUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { saveImage, UploadError } from "@/lib/uploads";

const MAX_FILE_SIZE = 2 * 1024 * 1024;

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

  try {
    // Type vérifié sur la signature binaire ; extension imposée par le serveur (anti-XSS).
    const avatarUrl = await saveImage(file, { folder: "avatars", prefix: currentUser.id, maxBytes: MAX_FILE_SIZE });

    const user = await prisma.user.update({
      where: { id: currentUser.id },
      data: { avatar: avatarUrl },
      select: { id: true, avatar: true },
    });

    return NextResponse.json({ user, avatarUrl });
  } catch (error) {
    if (error instanceof UploadError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
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
