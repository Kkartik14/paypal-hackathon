import { Injectable } from "@nestjs/common";
import type { Merchant, Profile, Scenario, TrustedRecipient } from "@scambrake/contracts";
import { SANDBOX_MERCHANT, SCAMBRAKE_PROFILE, SCENARIOS } from "../fixtures/profile-data";

@Injectable()
export class ContactsService {
  getProfile(): Profile {
    return SCAMBRAKE_PROFILE;
  }

  listRecipients(): TrustedRecipient[] {
    return SCAMBRAKE_PROFILE.trustedRecipients;
  }

  getMerchant(): Merchant {
    return SANDBOX_MERCHANT;
  }

  listScenarios(): Scenario[] {
    return SCENARIOS;
  }

  getScenario(id: string): Scenario | null {
    return SCENARIOS.find((scenario) => scenario.id === id) ?? null;
  }

  findRecipient(name?: string | null, identifier?: string | null): TrustedRecipient | null {
    const cleanIdentifier = normalizeIdentifier(identifier);
    const cleanName = normalizeName(name);

    for (const recipient of SCAMBRAKE_PROFILE.trustedRecipients) {
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

  isMerchant(name?: string | null, identifier?: string | null): boolean {
    const cleanIdentifier = normalizeIdentifier(identifier);
    if (cleanIdentifier && SANDBOX_MERCHANT.identifier && cleanIdentifier === normalizeIdentifier(SANDBOX_MERCHANT.identifier)) {
      return true;
    }
    const cleanName = normalizeName(name);
    return Boolean(cleanName && nameMatches(cleanName, SANDBOX_MERCHANT.name));
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
