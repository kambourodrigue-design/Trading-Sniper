export {};

declare global {
  interface Env {
    DB: D1Database;
    CACHE: KVNamespace;
    TWELVEDATA_API_KEY: string;
    JWT_SECRET: string;
    ADMIN_EMAILS: string;
    // IA (au moins une clé requise ; plus il y en a, plus la validation est robuste)
    DEEPSEEK_API_KEY?: string;
    GEMINI_API_KEY?: string;
    ANTHROPIC_API_KEY?: string;
    // Optionnels
    ALPHAVANTAGE_API_KEY?: string;
    DEEPSEEK_MODEL?: string;
    GEMINI_MODEL?: string;
    CLAUDE_MODEL?: string;
    MIN_SCORE?: string;
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
