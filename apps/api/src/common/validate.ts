import type { ZodType } from "zod";
import { ApiException } from "./api.exception";

export function parseWith<T>(schema: ZodType<T>, input: unknown, code = "INVALID_REQUEST"): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ApiException(400, code, "Request validation failed.", {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  return result.data;
}
