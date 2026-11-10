import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import next from "next";
import { attachSocketServer } from "./src/server/socket-server";

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = Number(process.env.PORT ?? 3000);

async function main(): Promise<void> {
  const app = next({ dev, hostname, port });
  await app.prepare();

  const httpServer = createServer((request, response) => {
    void app.getRequestHandler()(request, response);
  });

  attachSocketServer(httpServer);

  httpServer.listen(port, hostname, () => {
    console.log(`Application disponible sur http://localhost:${port}`);
    const addresses = Object.values(networkInterfaces())
      .flatMap((entries) => entries ?? [])
      .filter((entry) => entry.family === "IPv4" && !entry.internal)
      .map((entry) => entry.address);
    for (const address of addresses) {
      console.log(`Accès réseau local : http://${address}:${port}`);
    }
  });

  httpServer.on("error", (error) => {
    console.error("Erreur du serveur HTTP :", error);
    process.exitCode = 1;
  });
}

main().catch((error: unknown) => {
  console.error("Impossible de démarrer le serveur :", error);
  process.exitCode = 1;
});
