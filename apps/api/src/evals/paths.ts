import path from "node:path";

/**
 * Works from both src/evals (vitest) and dist/evals (the built CLI):
 * apps/api/{src|dist}/evals -> apps/api/evals.
 */
export const EVAL_ROOT = path.resolve(__dirname, "../../evals");
export const DEFAULT_CASES_PATH = path.join(EVAL_ROOT, "cases.json");
export const DEFAULT_CACHE_DIR = path.join(EVAL_ROOT, "cache");
export const DEFAULT_REPORTS_DIR = path.join(EVAL_ROOT, "reports");
