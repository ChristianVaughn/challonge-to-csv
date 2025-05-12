import { Elysia } from "elysia";
import { SimpleBracketRoutes } from "./routes/simpleBrackets";
import { cors } from "@elysiajs/cors";

const PORT = process.env.PORT || 3000;

const app = new Elysia()
.use(
  cors({
    origin: "*", // Allow all origins in development (use specific origins in production)
    methods: ["GET", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Authorization-Type"],
    exposedHeaders: ["Content-Disposition"] // Important for filename
  }),
)
  .use(SimpleBracketRoutes)
  .get("/", () => "Hello Challonge to CSV")
  .get("/success", () => "Authentication successful! You can now use the CSV export features.")
  .listen(PORT);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
);

export type App = typeof app;
