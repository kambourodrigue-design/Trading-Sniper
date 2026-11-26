# Lucide Sniper — V2 Shadow parallèle (26-11-2026)

## Comportement livré

- `Origin` reste le seul moteur de production et le seul autorisé à écrire dans `signals`.
- À chaque exécution du moteur, V2 est exécuté ensuite en observation parallèle, avec le profil strict.
- V2 réutilise les fonctions communes d'analyse ICT/SMC, mais possède une exécution isolée et ses propres tables. Ce n'est pas encore un algorithme IA entièrement distinct.
- Les candidats V2 sont virtuels : aucune insertion dans `signals`, aucun Telegram, aucune notification, aucun changement de paramètres Origin.
- Les résultats virtuels sont suivis par les mêmes règles de TP/SL dans `shadow_signals`.
- Une analyse par actif et par heure est enregistrée dans `shadow_runs`, y compris si aucun setup n'est validé, pour éviter de relancer les mêmes calculs toutes les cinq minutes.
- Les rapports et recommandations V2 lisent exclusivement `shadow_signals`. Minimum : 30 trades clôturés par actif/configuration avant de qualifier un résultat.
- La route de basculement production refuse `v2`. Le retour/maintien Origin reste disponible.

## Fichiers à remplacer / ajouter

1. Remplacer `src/engine/run.ts`
2. Ajouter `src/engine/shadow.ts`
3. Remplacer `src/engine/learning-v2.ts`
4. Remplacer `src/admin.ts`
5. Remplacer `src/lib/schema.ts`
6. Remplacer `schema.sql`
7. Remplacer `public/admin.html`

## D1

Les deux nouvelles tables (`shadow_signals`, `shadow_runs`) et leurs index sont créés automatiquement par `ensureSchema()` au premier appel Worker après déploiement. Le schéma est additif : aucune table existante n'est supprimée et aucune ligne `signals` / `signal_learning` n'est réécrite.

La migration autonome `MIGRATION-V2-SHADOW.sql` est fournie si une exécution manuelle est préférée. Elle utilise uniquement `CREATE ... IF NOT EXISTS`.

## Déploiement

1. Sauvegarder le projet et la D1 avant remplacement.
2. Remplacer/ajouter les sept fichiers ci-dessus en conservant le reste du projet.
3. Déployer avec `npm run deploy`.
4. Ouvrir l'administration, section apprentissage : vérifier `Origin` en production et `V2 — SHADOW`.
5. Laisser tourner plusieurs sessions de marché. Le tableau V2 se remplit uniquement lorsqu'un candidat strict est détecté et que ses TP/SL peuvent ensuite être suivis.

## Contrôles D1 après le premier appel Worker

```sql
SELECT name FROM sqlite_master
WHERE type='table' AND name IN ('shadow_signals','shadow_runs');

SELECT outcome, COUNT(*) AS total
FROM shadow_signals
GROUP BY outcome;

SELECT symbol, COUNT(*) AS total,
       SUM(CASE WHEN outcome='open' THEN 1 ELSE 0 END) AS ouverts,
       SUM(CASE WHEN outcome IN ('tp1','tp2','tp3') THEN 1 ELSE 0 END) AS tp,
       SUM(CASE WHEN outcome='sl' THEN 1 ELSE 0 END) AS sl,
       ROUND(AVG(r_multiple),3) AS r_moyen
FROM shadow_signals
GROUP BY symbol;

SELECT active_engine, reason FROM engine_control WHERE id=1;
```

## Limites de validation de cette livraison

Le SQL a été exécuté sur SQLite en mémoire et les fichiers TypeScript/JavaScript modifiés ont passé une vérification syntaxique. Le `tsc --noEmit` complet n'a pas pu être terminé dans l'environnement de préparation, car le paquet `@cloudflare/workers-types` n'y était pas installé. Il faut donc lancer `npm install` puis `npm run typecheck` dans l'environnement du projet avant de considérer le déploiement validé.

La V2 doit accumuler un échantillon suffisant, puis être évaluée sur une période hors-échantillon. Ne pas l'activer en production à ce stade.
