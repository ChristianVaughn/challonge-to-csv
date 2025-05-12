import { Elysia } from "elysia";
import { SimpleBracketRoutes } from "./routes/simpleBrackets";

const app = new Elysia()
  .use(SimpleBracketRoutes)
  .get("/", () => "Hello Challonge to CSV")
  .get("/success", () => "Authentication successful! You can now use the CSV export features.")
  .listen(3000);

export type App = typeof app;
