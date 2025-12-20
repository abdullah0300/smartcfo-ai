import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

config({
  path: ".env.local",
});

const runMigrate = async () => {
  let connectionString = process.env.POSTGRES_URL;

  // Fallback: Build URL from separate variables if POSTGRES_URL not set or has issues
  if (!connectionString && process.env.POSTGRES_HOST) {
    const host = process.env.POSTGRES_HOST;
    const port = process.env.POSTGRES_PORT || "5432";
    const database = process.env.POSTGRES_DATABASE || "postgres";
    const user = process.env.POSTGRES_USER;
    const password = process.env.POSTGRES_PASSWORD;
    
    if (user && password) {
      // Use postgres options directly instead of URL to avoid encoding issues
      const connection = postgres({
        host,
        port: parseInt(port),
        database,
        username: user,
        password,
        max: 1,
        ssl: "require",
      });
      const db = drizzle(connection);

      console.log("⏳ Running migrations...");

      const start = Date.now();
      await migrate(db, { migrationsFolder: "./lib/db/migrations" });
      const end = Date.now();

      console.log("✅ Migrations completed in", end - start, "ms");
      process.exit(0);
      return;
    }
  }

  if (!connectionString) {
    throw new Error("POSTGRES_URL is not defined and POSTGRES_HOST/USER/PASSWORD are not set");
  }

  const connection = postgres(connectionString, { max: 1 });
  const db = drizzle(connection);

  console.log("⏳ Running migrations...");

  const start = Date.now();
  await migrate(db, { migrationsFolder: "./lib/db/migrations" });
  const end = Date.now();

  console.log("✅ Migrations completed in", end - start, "ms");
  process.exit(0);
};

runMigrate().catch((err) => {
  console.error("❌ Migration failed");
  console.error(err);
  process.exit(1);
});
