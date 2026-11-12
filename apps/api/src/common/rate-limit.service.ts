import { Injectable } from "@nestjs/common";
import type { Request } from "express";

/**
 * Best-effort in-process rate limiting. Serverless instances do not share
 * memory, so this is a speed bump rather than a hard quota. The public deployment is
 * also protected by the platform's own limits and by bounding AI input sizes.
 */
@Injectable()
export class RateLimitService {
  private readonly buckets = new Map<string, number[]>();

  consume(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const recent = (this.buckets.get(key) ?? []).filter((time) => now - time < windowMs);
    if (recent.length >= limit) {
      this.buckets.set(key, recent);
      return false;
    }
    recent.push(now);
    this.buckets.set(key, recent);
    if (this.buckets.size > 5_000) this.prune(now, windowMs);
    return true;
  }

  private prune(now: number, windowMs: number): void {
    for (const [key, times] of this.buckets) {
      const recent = times.filter((time) => now - time < windowMs);
      if (recent.length === 0) this.buckets.delete(key);
      else this.buckets.set(key, recent);
    }
  }
}

export function clientKey(request: Request): string {
  // Uses Express's resolved client address. configureApp sets `trust proxy` so
  // this follows the single platform proxy on Vercel instead of raw headers.
  return request.ip || request.socket.remoteAddress || "unknown";
}
