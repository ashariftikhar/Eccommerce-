import dotenv from 'dotenv';
import path from 'path';
dotenv.config();
function numberFromEnv(name, fallback) {
    const raw = process.env[name];
    if (!raw) {
        return fallback;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
}
function nullable(value) {
    return value && value.trim() ? value.trim() : null;
}
export function loadConfig() {
    const storageDriver = process.env.STORAGE_DRIVER === 'postgres' ? 'postgres' : 'file';
    return {
        port: numberFromEnv('PORT', 3000),
        nodeEnv: process.env.NODE_ENV || 'development',
        appBaseUrl: process.env.APP_BASE_URL || `http://localhost:${numberFromEnv('PORT', 3000)}`,
        storageDriver,
        databaseUrl: nullable(process.env.DATABASE_URL),
        dataFilePath: process.env.DATA_FILE_PATH || path.join(process.cwd(), 'storage', 'app-state.json'),
        workerPollMs: numberFromEnv('WORKER_POLL_MS', 15_000),
        sessionSecret: process.env.SESSION_SECRET || 'replace-me',
        alertEmail: nullable(process.env.ALERT_EMAIL),
        ebay: {
            env: process.env.EBAY_ENV === 'production' ? 'production' : 'sandbox',
            clientId: nullable(process.env.EBAY_CLIENT_ID),
            clientSecret: nullable(process.env.EBAY_CLIENT_SECRET),
            redirectUri: nullable(process.env.EBAY_REDIRECT_URI),
            sandboxClientId: nullable(process.env.EBAY_SANDBOX_CLIENT_ID),
            sandboxClientSecret: nullable(process.env.EBAY_SANDBOX_CLIENT_SECRET),
            sandboxRedirectUri: nullable(process.env.EBAY_SANDBOX_REDIRECT_URI),
            marketplaceId: 'EBAY_US',
        },
        cj: {
            apiBaseUrl: process.env.CJ_API_BASE_URL || 'https://developers.cjdropshipping.com/api2.0/v1',
            apiKey: nullable(process.env.CJ_API_KEY),
            accessToken: nullable(process.env.CJ_ACCESS_TOKEN),
            requestsPerSecond: numberFromEnv('CJ_REQUESTS_PER_SECOND', 0.5),
            scanLimit: numberFromEnv('CJ_SCAN_LIMIT', 500),
        },
        ai: {
            deepseekApiKey: nullable(process.env.DEEPSEEK_API_KEY),
            deepseekModel: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
            geminiApiKey: nullable(process.env.GEMINI_API_KEY),
            geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
            monthlyCapUsd: numberFromEnv('AI_MONTHLY_CAP_USD', 20),
            dailyCapUsd: numberFromEnv('AI_DAILY_CAP_USD', 0.65),
        },
        sentryDsn: nullable(process.env.SENTRY_DSN),
    };
}
