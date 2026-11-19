export {};

declare global {
  interface Env {
    DB: D1Database;
    CACHE: KVNamespace;
    JWT_SECRET: string;
    ADMIN_EMAILS: string;
    AUTONOMOUS_ONLY?: string;    // true : mode autonome strict ; false : autorise la couche IA hybride
    HYBRID_GPT?: string;       // true : GPT donne un second avis sans bloquer la publication autonome
    // IA facultatives : le moteur de règles et le filtre macro fonctionnent sans clé IA payante.
    OPENAI_API_KEY?: string;
    OPENAI_MODEL?: string;
    OPENAI_EFFORT?: string;
    FUNDAMENTAL_SOL?: string;  // true : GPT-6 Sol ajoute une 2e couche d'analyse fondamentale aux signaux publiés
    OPENAI_SOL_MODEL?: string; // défaut : gpt-6-sol
    OPENAI_SOL_EFFORT?: string; // low, medium (défaut), high, xhigh, max
    DEEPSEEK_API_KEY?: string;
    GEMINI_API_KEY?: string;
    ANTHROPIC_API_KEY?: string;
    DEEPSEEK_MODEL?: string;
    GEMINI_MODEL?: string;
    CLAUDE_MODEL?: string;
    PROFILE?: string;
    MIN_SCORE?: string;
    MAX_PER_RUN?: string;
    AI_INDEPENDENT?: string;
    AI_PREFILTER_SCORE?: string;
    TELEGRAM_BOT_TOKEN?: string;
    TELEGRAM_CHAT_ID?: string;
    STRIPE_SECRET_KEY?: string;
    STRIPE_WEBHOOK_SECRET?: string;
    CINETPAY_API_KEY?: string;
    CINETPAY_SITE_ID?: string;
  }
}
