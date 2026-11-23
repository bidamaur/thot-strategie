import { describe, expect, it } from "vitest";
import { validateSettingValue } from "@/lib/settings/registry";
import {
  buildUssd,
  featureFromContext,
  internalReference,
  launchLabel,
  normalizeCameroonMobile,
  normalizeCountryCode,
  normalizeTransactionRef,
  paymentCountryCode,
  premiumPeriod,
  ussdTelHref,
} from "./rules";

const DAY = 86_400_000;
const now = new Date("2026-11-19T10:00:00Z");

describe("monétisation : codes USSD", () => {
  it("Orange : #150*1*1*{NUMERO}*{MONTANT}#", () => {
    expect(buildUssd("#150*1*1*{NUMERO}*{MONTANT}#", "656716849", 5000)).toBe("#150*1*1*656716849*5000#");
  });
  it("MTN : *126*1*1*{NUMERO}*{MONTANT}#", () => {
    expect(buildUssd("*126*1*1*{NUMERO}*{MONTANT}#", "677125468", 2000)).toBe("*126*1*1*677125468*2000#");
  });
  it("le numéro et le montant se placent où l'administrateur l'indique", () => {
    expect(buildUssd("*1*{MONTANT}*{NUMERO}#", "677125468", 10000)).toBe("*1*10000*677125468#");
  });
  it("code vide : aucun code proposé", () => {
    expect(buildUssd("  ", "656716849", 5000)).toBeNull();
  });
  it("lien de composition : # encodé", () => {
    expect(ussdTelHref("#150*1*1*656716849*5000#")).toBe("tel:%23150*1*1*656716849*5000%23");
  });
  it("le paramétrage refuse un code USSD mal formé", () => {
    expect(validateSettingValue("payments.orange.ussd", "#150*1*1*{NUMERO}*{MONTANT}#").ok).toBe(true);
    expect(validateSettingValue("payments.mtn.ussd", "*126*1*1*{NUMERO}*{MONTANT}#").ok).toBe(true);
    expect(validateSettingValue("payments.mtn.ussd", "*126*{PIN}#").ok).toBe(false);
    expect(validateSettingValue("payments.mtn.ussd", "<script>").ok).toBe(false);
    expect(validateSettingValue("payments.orange.number", "656716849").ok).toBe(true);
    expect(validateSettingValue("payments.orange.number", "12345").ok).toBe(false);
  });
});

describe("monétisation : numéros, pays, références", () => {
  it("numéro mobile camerounais, avec ou sans indicatif", () => {
    expect(normalizeCameroonMobile("656716849")).toBe("656716849");
    expect(normalizeCameroonMobile("+237 6 77 12 54 68")).toBe("677125468");
    expect(normalizeCameroonMobile("00237677125468")).toBe("677125468");
    expect(normalizeCameroonMobile("222 22 22 22")).toBeNull(); // fixe
    expect(normalizeCameroonMobile("+33 6 12 34 56 78")).toBeNull();
    expect(normalizeCameroonMobile("65671684")).toBeNull();
  });
  it("pays : texte libre normalisé ; le pays confirmé par l'administration prime", () => {
    expect(normalizeCountryCode("Cameroun")).toBe("CM");
    expect(normalizeCountryCode(" cameroon ")).toBe("CM");
    expect(normalizeCountryCode("Côte d’Ivoire")).toBe("CI");
    expect(normalizeCountryCode("Atlantide")).toBeNull();
    expect(paymentCountryCode({ country: "Cameroun", verifiedCountryCode: "FR" })).toBe("FR");
    expect(paymentCountryCode({ country: "France", verifiedCountryCode: "CM" })).toBe("CM");
  });
  it("référence de transaction normalisée", () => {
    expect(normalizeTransactionRef(" ci241119.1530.a12345 ")).toBe("CI241119.1530.A12345");
    expect(normalizeTransactionRef("MP 2411 19AB")).toBe("MP241119AB");
    expect(normalizeTransactionRef("ab")).toBeNull();
    expect(normalizeTransactionRef("<x>")).toBeNull();
    expect(normalizeTransactionRef(42)).toBeNull();
  });
  it("référence interne lisible", () => {
    expect(internalReference("PREMIUM")).toMatch(/^PAY-[2-9A-HJ-NP-Z]{8}$/);
    expect(internalReference("DONATION")).toMatch(/^DON-/);
  });
  it("date de lancement affichée en clair", () => {
    expect(launchLabel("2027-02-01")).toBe("février 2027");
  });
  it("contextes des messages Premium → fonctionnalités mesurées", () => {
    expect(featureFromContext("stats")).toBe("ADVANCED_STATS");
    expect(featureFromContext("quota")).toBe("UNLIMITED_GAMES");
    expect(featureFromContext("inconnu")).toBe("PREMIUM_OFFER");
  });
});

describe("monétisation : période Premium accordée à la validation", () => {
  const tier = (level: number, durationDays = 30) => ({ level, durationDays });
  it("nouvel abonné : à partir de maintenant, expiration = début + durée", () => {
    const p = premiumPeriod({ isPremium: false, premiumLevel: 0, premiumExpiresAt: null }, tier(2), now)!;
    expect(p.startsAt).toEqual(now);
    expect(p.expiresAt.getTime()).toBe(now.getTime() + 30 * DAY);
  });
  it("même niveau encore actif : prolongation depuis l'échéance", () => {
    const end = new Date(now.getTime() + 10 * DAY);
    const p = premiumPeriod({ isPremium: true, premiumLevel: 2, premiumExpiresAt: end }, tier(2), now)!;
    expect(p.startsAt).toEqual(end);
    expect(p.expiresAt.getTime()).toBe(end.getTime() + 30 * DAY);
  });
  it("niveau supérieur : remplace dès maintenant", () => {
    const end = new Date(now.getTime() + 10 * DAY);
    const p = premiumPeriod({ isPremium: true, premiumLevel: 1, premiumExpiresAt: end }, tier(3, 60), now)!;
    expect(p.startsAt).toEqual(now);
    expect(p.expiresAt.getTime()).toBe(now.getTime() + 60 * DAY);
  });
  it("abonnement expiré : repart de maintenant", () => {
    const p = premiumPeriod({ isPremium: true, premiumLevel: 4, premiumExpiresAt: new Date(now.getTime() - DAY) }, tier(1), now)!;
    expect(p.startsAt).toEqual(now);
  });
  it("niveau inférieur au niveau actif : refusé", () => {
    expect(premiumPeriod({ isPremium: true, premiumLevel: 4, premiumExpiresAt: new Date(now.getTime() + DAY) }, tier(2), now)).toBeNull();
  });
});
