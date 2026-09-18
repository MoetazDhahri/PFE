import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  // A forward-slash relative glob, not path.join(__dirname, ...): on
  // Windows, path.join produces backslashes that drizzle-kit's glob
  // matcher does not resolve, silently finding zero schema files.
  schema: "./src/schema/*.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
