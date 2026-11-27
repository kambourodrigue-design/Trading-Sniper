export {};

declare global {
  interface Env {
    DB: D1Database;
    CACHE: KVNamespace;
    JWT_SECRET: string;
    ADMIN_EMAILS: string;
    AUTONOMOUS_ONLY?: string;    // true : mode autonome strict ; false : autorise la couche IA hybride
    HYBRID_GPT?: string;       // true : OpenAI (prioritaire) ou DeepSeek donne un second avis sans bloquer le moteur autonome
    // IA facultatives : le moteur de règles et le filtre macro fonctionnent sans clé IA payante.
    OPENAI_API_KEY?: string;
    OPENAI_MODEL?: string; // par défaut : gpt-6-luna (second avis économique, si clé OpenAI configurée)
    OPENAI_EFFORT?: string; // medium par défaut : meilleur équilibre analyse/latence/coût
    DEEPSEEK_API_KEY?: string;
    GEMINI_API_KEY?: string;
    ANTHROPIC_API_KEY?: string;
    DEEPSEEK_MODEL?: string;
    GEMINI_MODEL?: string;
    CLAUDE_MODEL?: string;
    PROFILE?: string; // strict | balanced | active | adaptive
    MIN_SCORE?: string;
    MAX_PER_RUN?: string;
    AI_INDEPENDENT?: string;
    AI_PREFILTER_SCORE?: string;
    TELEGRAM_BOT_TOKEN?: string;
    TELEGRAM_CHAT_ID?: string;
    TELEGRAM_V2_ENABLED?: string; // true pour notifier les setups virtuels V2
    TELEGRAM_V2_MIN_SCORE?: string; // score minimal, 75 par défaut
    STRIPE_SECRET_KEY?: string;
    STRIPE_WEBHOOK_SECRET?: string;
    CINETPAY_API_KEY?: string;
    CINETPAY_SITE_ID?: string;
  }
}
