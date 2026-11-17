import { getRequestUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { saveImage, UploadError } from "@/lib/uploads";
import { deleteByUrl, StorageError } from "@/lib/storage";
import { getSetting } from "@/lib/settings/service";

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
    // Image compressée (WebP, 256 px par défaut) puis enregistrée dans le stockage configuré.
    const maxKb = await getSetting("community.imageMaxKb");
    const previous = await prisma.user.findUnique({ where: { id: currentUser.id }, select: { avatar: true } });
    const avatarUrl = await saveImage(file, { kind: "avatar", prefix: currentUser.id, maxBytes: maxKb * 1024 });

    const user = await prisma.user.update({
      where: { id: currentUser.id },
      data: { avatar: avatarUrl },
      select: { id: true, avatar: true },
    });
    await deleteByUrl(previous?.avatar);

    return NextResponse.json({ user, avatarUrl });
  } catch (error) {
    if (error instanceof UploadError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof StorageError) {
      console.error("Stockage des images indisponible :", error.message);
      return NextResponse.json({ error: "Le stockage des images est momentanément indisponible." }, { status: 503 });
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
