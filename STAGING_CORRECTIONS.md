# Lucide Sniper — correctifs de staging (20 novembre 2026)

Cette archive contient des correctifs préparés pour essai. Elle n'a pas été déployée.

## Modifications
- Stop Loss structurel : sélection de l'invalidation valide la plus proche du prix, exclusion des zones du mauvais côté, prise en compte de la mèche de sweep uniquement si cohérente, buffer de 0,25 ATR.
- Suppression de l'élargissement artificiel du risque minimum à 0,8 ATR. Le filtre de risque maximal de 3 ATR reste actif : au-delà, le setup est rejeté.
- BSL/SSL : le niveau affiché est désormais le niveau le plus proche du prix.
- Second avis IA : OpenAI est prioritaire si `OPENAI_API_KEY` existe ; DeepSeek est utilisé à défaut si `DEEPSEEK_API_KEY` existe. L'avis ne modifie jamais les niveaux et ne bloque jamais le moteur autonome.
- Aucun changement de schéma SQL, de D1, de KV ou de fréquence Cron.

## Vérifications
- 20 tests unitaires exécutés avec succès.
- Vérification TypeScript exécutée avec succès à l'aide de déclarations temporaires minimales pour les interfaces Cloudflare.
- Les types Cloudflare officiels n'ont pas pu être téléchargés dans cet environnement ; la commande TypeScript standard avec les dépendances officielles n'a donc pas pu être exécutée.
- Aucun backtest historique réel n'a été terminé. Les données synthétiques ne sont pas une preuve de rentabilité.

## Configuration IA
- `HYBRID_GPT=true` active le second avis facultatif.
- `OPENAI_API_KEY` est facultative ; modèle configuré : `gpt-6-luna`, effort `medium`.
- Si la clé OpenAI est absente, `DEEPSEEK_API_KEY` est utilisé si présent.
- Les API sont facturées séparément de l'abonnement ChatGPT. Ne pas ajouter de secret dans un fichier ou dans le chat.

## Déploiement / retour arrière
- Ne pas exécuter `db:apply` ou `db:apply:remote` pour cette mise à jour : aucun changement SQL n'est requis.
- Conserver l'archive actuellement déployée et les identifiants D1/KV.
- Déployer uniquement le Worker et les assets après vérification des secrets et du nom du Worker.
- En cas de problème, revenir à la version précédente du Worker depuis l'historique des déploiements Cloudflare. Les données D1/KV n'ont pas été modifiées par la préparation de cette archive.

## 20/11/2026 — Onglet Backtest
- Ajout d’un onglet administrateur et d’une route API protégée par le contrôle administrateur existant.
- Un seul actif par exécution, 3 ou 7 jours d’évaluation, profil strict/équilibré/actif/adaptatif.
- Affichage du win rate, profit factor, espérance, R net, drawdown, liste des setups et source historique utilisée.
- Aucun changement de schéma D1/KV et aucun déploiement.
- Limites : disponibilité historique du fournisseur, coûts estimés en ATR, pas de news ni d’avis IA; tests TypeScript non exécutés (installation des dépendances expirée).

## Backtest fondamental avec annonces historiques (20/11/2026)
- Ajout de trois modes : technique seul, filtre annonces, et filtre annonces + surprise macro directionnelle.
- Le endpoint admin accepte une liste d'événements historiques horodatés (UTC), avec devise, impact, prévision et réel. L'interface permet de coller le JSON ou d'importer un fichier `.json`.
- Le filtre High reprend les fenêtres de blocage du moteur (45 min avant / 20 min après). Le mode fondamental applique `fundamentalBias` aux surprises actual/prévision disponibles dans les six heures précédentes ; il reste neutre si les données manquent.
- Le résultat expose le nombre d'événements chargés, de décisions bloquées et de rejets directionnels macro.
- Limite majeure : aucune archive historique d'annonces n'est fournie automatiquement par ShowMyTrades dans le code actuel (son endpoint est un calendrier glissant de 7 jours). Les modes B/C exigent donc un fichier historique externe vérifié. Ne pas présenter ce backtest comme un replay macro complet tant que cette archive n'est pas alimentée.
- Le backtest Worker demeure borné à 3–7 jours et utilise les bougies disponibles. Ce n'est pas encore une validation longue durée.

## Revue complémentaire — historique local et walk-forward (20 novembre 2026)
- Le backtest local lit désormais en priorité les fichiers `./historical/<SYMBOL>/H1.csv`, `H4.csv`, `D1.csv` et, avec `--live`, `M15.csv` produits par le téléchargeur. Dossier personnalisable avec `--history-dir`.
- En mode `--live`, M15 doit contenir au moins 500 bougies et H4 au moins 105 ; un jeu insuffisant n'est pas utilisé silencieusement comme si les sorties M15 avaient été testées.
- Le rapport JSON exporte les métriques séparées de calibration et de test hors échantillon dans `walk_forward`; la page de rapport les affiche également.
- Tests exécutés après correction : 4 tests Python du téléchargeur réussis ; transpilation TypeScript sans diagnostic de syntaxe pour `scripts/backtest.ts` ; scripts JavaScript des pages Replay et Rapport validés par `node --check` ; archive ZIP vérifiée.
- Limite restante : l'installation npm a expiré dans cet environnement. Le `tsc --noEmit` complet ne peut pas être validé car `@cloudflare/workers-types` n'est pas installé. Aucun backtest sur deux ans n'a été exécuté ici.
