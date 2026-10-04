import app from "../artifacts/api-server/src/app.ts";

const port = Number(process.env.PORT ?? 3001);

const server = app.listen(port, "127.0.0.1", () => {
  console.log(`E2E API server listening on http://127.0.0.1:${port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
