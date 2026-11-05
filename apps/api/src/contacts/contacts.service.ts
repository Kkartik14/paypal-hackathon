import { Injectable } from "@nestjs/common";
import type { DemoMerchant, DemoProfile, Scenario, TrustedRecipient } from "@scambrake/contracts";
import { DEMO_MERCHANT, DEMO_PROFILE, DEMO_SCENARIOS } from "../demo/demo-data";

@Injectable()
export class ContactsService {
  getProfile(): DemoProfile {
    return DEMO_PROFILE;
  }

  listRecipients(): TrustedRecipient[] {
    return DEMO_PROFILE.trustedRecipients;
  }

  getMerchant(): DemoMerchant {
    return DEMO_MERCHANT;
  }

  listScenarios(): Scenario[] {
    return DEMO_SCENARIOS;
  }

  getScenario(id: string): Scenario | null {
    return DEMO_SCENARIOS.find((scenario) => scenario.id === id) ?? null;
  }

  findRecipient(name?: string | null, identifier?: string | null): TrustedRecipient | null {
    const cleanIdentifier = normalizeIdentifier(identifier);
    const cleanName = normalizeName(name);

    for (const recipient of DEMO_PROFILE.trustedRecipients) {
      if (cleanIdentifier && recipient.identifier && normalizeIdentifier(recipient.identifier) === cleanIdentifier) {
        return recipient;
      }
      if (cleanName && nameMatches(cleanName, recipient.name)) {
        return recipient;
      }
      for (const alias of recipient.aliases) {
        if (cleanName && nameMatches(cleanName, alias)) {
          return recipient;
        }
      }
    }
    return null;
  }

  isDemoMerchant(name?: string | null, identifier?: string | null): boolean {
    const cleanIdentifier = normalizeIdentifier(identifier);
    if (cleanIdentifier && DEMO_MERCHANT.identifier && cleanIdentifier === normalizeIdentifier(DEMO_MERCHANT.identifier)) {
      return true;
    }
    const cleanName = normalizeName(name);
    return Boolean(cleanName && nameMatches(cleanName, DEMO_MERCHANT.name));
  }
}

export function normalizeName(value?: string | null): string {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeIdentifier(value?: string | null): string {
  return (value ?? "").trim().toLowerCase();
}

export function nameMatches(left: string, right: string): boolean {
  const a = normalizeName(left);
  const b = normalizeName(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  return shorter.length >= 4 && longer.includes(shorter);
}
