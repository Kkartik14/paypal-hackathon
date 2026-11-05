import { config } from "dotenv";
import { resolve } from "node:path";

/**
 * Loads environment variables before AppConfig is constructed.
 * Existing process environment variables always win over .env files.
 * Lookup order: repository root .env, apps/api/.env, then the working directory.
 */
config({ path: resolve(__dirname, "../../../.env") });
config({ path: resolve(__dirname, "../.env") });
config();
