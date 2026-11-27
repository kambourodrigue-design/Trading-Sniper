# Limite globale : une seule position Shadow ouverte

La création d'un signal dans `src/engine/shadow.ts` vérifie désormais qu'aucune ligne `shadow_signals` n'a `outcome='open'`, tous symboles confondus.

La vérification est intégrée directement à l'instruction `INSERT ... SELECT ... WHERE NOT EXISTS` : elle est atomique au niveau de l'écriture D1 et protège contre deux scans concurrents qui tenteraient d'ouvrir simultanément des positions sur des actifs différents.

Si une position est déjà ouverte, le candidat suivant n'est pas inséré et le résultat du scan porte le statut `blocked_open_position`. Le suivi TP/SL continue jusqu'à la clôture. Une fois clôturée, un nouveau signal peut être ouvert.

Cette règle s'applique uniquement à V2 Shadow. Elle ne modifie pas Origin et ne nécessite aucune migration D1.
