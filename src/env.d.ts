export {};

declare global {
  interface Env {
    DB: D1Database;
    CACHE: KVNamespace;
    LSE_API_KEY?: string;        // LSE Data (London Strategic Edge) : source de données de marché (requise pour analyser)
    JWT_SECRET: string;
    ADMIN_EMAILS: string;
    // IA (au moins une clé requise ; plus il y en a, plus la validation est robuste)
    OPENAI_API_KEY?: string;     // GPT-6 (gpt-6-astra)
    OPENAI_MODEL?: string;       // défaut : gpt-6-astra (repli : gpt-5.6-sol)
    OPENAI_EFFORT?: string;      // low | medium (défaut) | high | xhigh | max — plus haut = plus d'analyse, plus cher
    DEEPSEEK_API_KEY?: string;
    GEMINI_API_KEY?: string;
    ANTHROPIC_API_KEY?: string;
    // Optionnels
    DERIV_APP_ID?: string;       // app_id Deriv (défaut 1089 = application de test publique ; crée la tienne sur api.deriv.com)
    ALPHAVANTAGE_API_KEY?: string;
    DEEPSEEK_MODEL?: string;
    GEMINI_MODEL?: string;
    CLAUDE_MODEL?: string;
    PROFILE?: string;            // strict | balanced (défaut) | active
    MIN_SCORE?: string;          // facultatif : remplace le seuil du profil
    MAX_PER_RUN?: string;
    AI_INDEPENDENT?: string;     // off | prefilter (défaut) | always
    AI_PREFILTER_SCORE?: string; // score minimal du moteur pour lancer l'analyse indépendante (défaut 30)
    // Telegram (optionnel, usage personnel)
    TELEGRAM_BOT_TOKEN?: string;
    TELEGRAM_CHAT_ID?: string;   // ton chat ou canal ; plusieurs possibles, séparés par des virgules
    // Paiements (à brancher)
    STRIPE_SECRET_KEY?: string;
    STRIPE_WEBHOOK_SECRET?: string;
    CINETPAY_API_KEY?: string;
    CINETPAY_SITE_ID?: string;
  }
}
