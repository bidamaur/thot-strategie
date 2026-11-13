import { prisma } from "../src/lib/prisma";

async function main() {
  const username = process.argv[2];
  if (!username) {
    console.error("Usage: tsx scripts/make-admin.ts <username>");
    process.exit(1);
  }
  const user = await prisma.user.update({
    where: { username: username.trim().toLowerCase() },
    data: { isAdmin: true },
    select: { id: true, username: true, isAdmin: true, isPremium: true },
  });
  console.log(JSON.stringify(user, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
