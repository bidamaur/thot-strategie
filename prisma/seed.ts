import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/auth/session";

const demoProfiles = [
  {
    username: "admin",
    password: "AdminThot2026!",
    pointsFree: 50,
    isAdmin: true,
    country: "Côte d’Ivoire",
    city: "Abidjan",
    neighborhood: "Cocody",
  },
  {
    username: "joueur50",
    password: "Joueur50Test!",
    pointsFree: 50,
    isAdmin: false,
    country: "Côte d’Ivoire",
    city: "Abidjan",
    neighborhood: "Cocody",
  },
  {
    username: "joueur100",
    password: "Joueur100Test!",
    pointsFree: 100,
    isAdmin: false,
    country: "Côte d’Ivoire",
    city: "Abidjan",
    neighborhood: "Plateau",
  },
  {
    username: "joueur200",
    password: "Joueur200Test!",
    pointsFree: 200,
    isAdmin: false,
    country: "Côte d’Ivoire",
    city: "Abidjan",
    neighborhood: "Yopougon",
  },
] as const;

async function seedDemoProfiles() {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("Les profils de démonstration peuvent uniquement être chargés en développement.");
  }

  for (const profile of demoProfiles) {
    const { password, ...userData } = profile;
    const passwordHash = await hashPassword(password);
    await prisma.user.upsert({
      where: { username: userData.username },
      create: { ...userData, passwordHash },
      update: {
        passwordHash,
        isAdmin: userData.isAdmin,
        country: userData.country,
        city: userData.city,
        neighborhood: userData.neighborhood,
      },
    });
  }
  console.info("Profils de démonstration et mots de passe mis à jour.");
}

seedDemoProfiles()
  .catch((error: unknown) => {
    console.error("Échec du chargement des profils de démonstration :", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
