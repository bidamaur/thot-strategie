-- Retour arrière (perte des événements de mesure d audience)
DROP TABLE IF EXISTS "AnalyticsEvent";
ALTER TABLE "User" DROP COLUMN IF EXISTS "engagement";
-- La valeur OBJECTIVE_REWARD de l enum ne peut pas être retirée sans recréer le type ; elle reste inutilisée.
