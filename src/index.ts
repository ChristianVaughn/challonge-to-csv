import { Elysia } from "elysia";
import { SimpleBracketRoutes } from "./routes/simpleBrackets";
const PORT = process.env.PORT || 3000;
const app = new Elysia()
  .use(SimpleBracketRoutes)
  .get("/", () => "Hello Challonge to CSV")
  .get("/success", () => "Authentication successful! You can now use the CSV export features.")
  .listen(PORT);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
);

export type App = typeof app;
