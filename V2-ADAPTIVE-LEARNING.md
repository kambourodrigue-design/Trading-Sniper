# Lucide Sniper V2 — Adaptive Learning

- Collecte les résultats clôturés des seuls signaux `shadow_signals`.
- Regroupe par actif et stratégie.
- Trie chronologiquement : 70 % apprentissage, 30 % validation hors-échantillon.
- Minimum 30 trades au total et 10 dans la période de validation.
- Classe les résultats : insufficient_data, stable_promising, degraded ou inconclusive.
- Met à jour `v2_adaptive_insights` à chaque cycle V2.
- Expose les résultats via `/api/admin/learning/v2/adaptive` et dans `/api/admin/learning/v2/recommendations`.

**Sécurité :** aucune optimisation automatique de seuil/poids n'est appliquée. Les résultats produisent des propositions fondées sur une validation chronologique ; l'approbation humaine et un test séparé restent requis. Origin et ses paramètres ne sont jamais modifiés.
