-- Retour arrière (perte des préférences de plateau)
ALTER TABLE "User" DROP COLUMN IF EXISTS "boardPrefs";
