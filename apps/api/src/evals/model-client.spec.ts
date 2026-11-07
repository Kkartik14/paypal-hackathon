import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getPromptVersion, promptHash } from "../agent/prompts";
import { loadEvalCases } from "./cases";
import {
  EvalSetupError,
  ReplayModelClient,
  cacheFilePath,
  modelSlug,
} from "./model-client";
import { DEFAULT_CASES_PATH } from "./paths";

const CASES = loadEvalCases(DEFAULT_CASES_PATH);
const CASE = CASES[0];
if (!CASE) throw new Error("no eval cases");

const MODEL = "openai/gpt-oss-120b";
const VERSION = getPromptVersion("v2-hardened");
const ROOT = mkdtempSync(path.join(tmpdir(), "scambrake-eval-cache-"));

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    promptVersion: VERSION.id,
    promptHash: promptHash(VERSION),
    model: MODEL,
    caseId: CASE.id,
    recordedAt: new Date().toISOString(),
    latencyMs: 123,
    usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    raw: CASE.idealExtraction,
    ...overrides,
  };
}

function writeCache(dir: string, overrides: Record<string, unknown> = {}): string {
  const file = cacheFilePath(dir, VERSION.id, MODEL, CASE.id);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(entry(overrides)), "utf8");
  return file;
}

function testDir(name: string): string {
  const dir = path.join(ROOT, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("cache paths", () => {
  it("slugs the model name so the cache path is file-safe", () => {
    expect(modelSlug("openai/gpt-oss-120b")).toBe("openai-gpt-oss-120b");
    expect(modelSlug("meta-llama/llama 4:scout")).toBe("meta-llama-llama-4-scout");
  });

  it("versions the cache by prompt and case", () => {
    const file = cacheFilePath("/tmp/cache", "v2-hardened", MODEL, "scam-safe-account");
    expect(file).toBe(
      "/tmp/cache/v2-hardened/openai-gpt-oss-120b/scam-safe-account.json",
    );
  });
});

describe("ReplayModelClient", () => {
  it("returns a recorded response without calling a provider", async () => {
    const dir = testDir("valid");
    writeCache(dir);
    const client = new ReplayModelClient({ cacheDir: dir, model: MODEL });

    const response = await client.extract({ evalCase: CASE, version: VERSION });

    expect(client.name).toBe("replay");
    expect(client.model).toBe(MODEL);
    expect(response.raw).toEqual(CASE.idealExtraction);
    expect(response.latencyMs).toBe(123);
    expect(response.usage?.totalTokens).toBe(150);
  });

  it("fails with instructions when a case has not been recorded", async () => {
    const client = new ReplayModelClient({
      cacheDir: testDir("missing"),
      model: MODEL,
    });

    await expect(client.extract({ evalCase: CASE, version: VERSION })).rejects.toThrow(
      /No cached response for case/,
    );
    await expect(client.extract({ evalCase: CASE, version: VERSION })).rejects.toThrow(
      /pnpm eval:live/,
    );
  });

  it("fails loudly when the prompt changed after the response was recorded", async () => {
    const dir = testDir("drift");
    writeCache(dir, { promptHash: "0".repeat(64) });
    const client = new ReplayModelClient({ cacheDir: dir, model: MODEL });

    const error = await client
      .extract({ evalCase: CASE, version: VERSION })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(EvalSetupError);
    expect((error as Error).message).toMatch(/recorded with a different prompt/);
    expect((error as Error).message).toMatch(/pnpm eval:live/);
  });

  it("refuses a cache entry recorded for another model", async () => {
    const dir = testDir("model-mismatch");
    writeCache(dir, { model: "some/other-model" });
    const client = new ReplayModelClient({ cacheDir: dir, model: MODEL });

    await expect(client.extract({ evalCase: CASE, version: VERSION })).rejects.toThrow(
      /was recorded with model/,
    );
  });

  it("refuses a cache entry recorded for another case", async () => {
    const dir = testDir("case-mismatch");
    writeCache(dir, { caseId: "another-case" });
    const client = new ReplayModelClient({ cacheDir: dir, model: MODEL });

    await expect(client.extract({ evalCase: CASE, version: VERSION })).rejects.toThrow(
      /is for case/,
    );
  });

  it("refuses a cache entry from another prompt version", async () => {
    const dir = testDir("version-mismatch");
    writeCache(dir, { promptVersion: "v1-baseline" });
    const client = new ReplayModelClient({ cacheDir: dir, model: MODEL });

    await expect(client.extract({ evalCase: CASE, version: VERSION })).rejects.toThrow(
      /is for prompt version/,
    );
  });

  it("refuses a malformed cache entry instead of scoring garbage", async () => {
    const file = cacheFilePath(testDir("malformed"), VERSION.id, MODEL, CASE.id);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ raw: {} }), "utf8");
    const client = new ReplayModelClient({
      cacheDir: path.dirname(path.dirname(path.dirname(file))),
      model: MODEL,
    });

    await expect(client.extract({ evalCase: CASE, version: VERSION })).rejects.toThrow(
      /Invalid cache entry/,
    );
  });

  it("refuses invalid JSON instead of silently treating it as an empty result", async () => {
    const file = cacheFilePath(testDir("invalid-json"), VERSION.id, MODEL, CASE.id);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "{not json", "utf8");
    const client = new ReplayModelClient({
      cacheDir: path.dirname(path.dirname(path.dirname(file))),
      model: MODEL,
    });

    await expect(client.extract({ evalCase: CASE, version: VERSION })).rejects.toThrow(
      EvalSetupError,
    );
  });
});
