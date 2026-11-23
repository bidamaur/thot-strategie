-- Retour arrière (perte des déclarations de paiement, intérêts et disponibilités).
-- Attention : les abonnements Premium déjà activés restent sur User.
DROP TABLE IF EXISTS "PlayerAvailability";
DROP TABLE IF EXISTS "PremiumInterest";
DROP TABLE IF EXISTS "Payment";
ALTER TABLE "User" DROP COLUMN IF EXISTS "verifiedCountryCode";
