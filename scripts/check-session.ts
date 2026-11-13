import { prisma } from "../src/lib/prisma";

async function main() {
  try {
    const count = await prisma.userSession.count();
    console.log("userSession count:", count);
    const users = await prisma.user.findMany({ take: 5, select: { id: true, username: true, isAdmin: true, isPremium: true } });
    console.log("users:", JSON.stringify(users, null, 2));
  } catch (e) {
    console.error("ERR", e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
