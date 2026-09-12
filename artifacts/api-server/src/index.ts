import app from "./app";
import { logger } from "./lib/logger";
import { seedInventoryIfEmpty } from "./lib/inventory-seed";

const isProduction =
  process.env.NODE_ENV === "production";

const rawPort =
  process.env.PORT ??
  (isProduction ? undefined : "3001");

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required in production.",
  );
}

const port = Number(rawPort);

if (!Number.isFinite(port) || port <= 0) {
  throw new Error(
    `Invalid PORT value: "${rawPort}"`,
  );
}

async function start() {
  await seedInventoryIfEmpty();

  app.listen(port, (err) => {
    if (err) {
      logger.error(
        { err },
        "Error listening on port",
      );
      process.exit(1);
    }

    logger.info(
      { port },
      "Server listening",
    );
  });
}

start().catch((err: unknown) => {
  logger.error(
    { err },
    "Unable to start server",
  );
  process.exit(1);
});
