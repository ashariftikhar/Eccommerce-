import crypto from 'crypto';
export function nowIso() {
    return new Date().toISOString();
}
export function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
export function round(value, digits = 2) {
    return Number(value.toFixed(digits));
}
export function createId(prefix) {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}
export function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}
export function shortHash(value) {
    return sha256(value).slice(0, 10).toUpperCase();
}
export function normalizeKeyword(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
export function median(values) {
    if (!values.length) {
        return 0;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
export function businessDaysFromNow(days) {
    const date = new Date();
    let remaining = days;
    while (remaining > 0) {
        date.setUTCDate(date.getUTCDate() + 1);
        const day = date.getUTCDay();
        if (day !== 0 && day !== 6) {
            remaining -= 1;
        }
    }
    return date.toISOString();
}
export function daysFromNow(days) {
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}
export function withJitter(ms) {
    return Math.round(ms * (0.85 + Math.random() * 0.3));
}
export function isPoBox(line1) {
    return /\b(p\.?\s*o\.?|post office)\s*box\b/i.test(line1);
}
export function isMilitaryAddress(line1, city) {
    return /\b(APO|FPO|DPO)\b/i.test(line1) || /\b(APO|FPO|DPO)\b/i.test(city);
}
