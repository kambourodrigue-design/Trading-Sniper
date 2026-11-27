# Lucide Sniper V2 — évolution multi-stratégies

## Modifications

- Ajout d'une détection indépendante de continuation de tendance : biais H4/D1, SMA20/SMA50, pullback M15, reprise directionnelle et stop structurel derrière le swing.
- Conservation des familles existantes : ICT/SMC (sweep, MSS, displacement, FVG), range/rejet, fakeout et breakout/retest.
- Un candidat de range non exploitable ne bloque plus automatiquement les autres détecteurs.
- Les objectifs restent calculés à 2R / 5R / 8R. Le contrôle final RR et le seuil de 82/100 restent obligatoires.
- La limite globale d'une position Shadow est maintenant contrôlée au niveau central et dans l'INSERT conditionnel. Un setup autrement valide est classé `blocked_open_position` au lieu d'être confondu avec un rejet technique.
- Les notes de rejet, de données périmées et d'erreur sont maintenant persistées dans `shadow_runs.note`.
- Les historiques existants de `shadow_runs` sont conservés par une migration additive.
- Le stop de range peut être jusqu'à 2 ATR M15 (au lieu de 1,8) lorsque l'invalidation structurelle l'exige ; il n'est jamais resserré artificiellement. Le breakout de test dont le stop est très large reste rejeté.

## Migration D1 distante obligatoire

Exécuter une seule fois le fichier :

`MIGRATION-SHADOW-RUN-NOTES-27-11-2026.sql`

Ne pas réexécuter `schema.sql` pour cette mise à jour : la migration dédiée suffit et ne touche pas à `shadow_signals` ni à `shadow_telegram_events`.

## Fichiers modifiés

- `src/engine/liquidity-engine.ts`
- `src/engine/range-engine.ts`
- `src/engine/shadow.ts`
- `src/lib/schema.ts`
- `schema.sql`
- `scripts/test.ts`

## Sécurité et limites

- Mode Shadow uniquement : aucune exécution d'ordre réel.
- Origin n'est pas modifié.
- Une seule position Shadow ouverte globalement.
- Les données de marché trop anciennes restent refusées. Cette mise à jour ne remplace pas une source de données XAU/USD indisponible et ne maquille pas une bougie périmée en donnée récente.
- La stratégie de continuation est une nouvelle logique à valider sur historique et en Shadow ; elle ne constitue pas une garantie de rentabilité.
