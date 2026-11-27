-- Migration additive : conserve les historiques shadow_runs existants.
-- À exécuter une seule fois sur la base D1 distante avant le déploiement du Worker.
ALTER TABLE shadow_runs ADD COLUMN note TEXT;
