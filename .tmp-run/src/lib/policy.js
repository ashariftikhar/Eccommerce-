import { createId, normalizeKeyword } from './utils';
export function seedProhibitedRules() {
    return [
        { id: createId('rule'), keyword: 'adult', category: 'all', severity: 'block', reason: 'Adult items are outside YuziGoods policy.' },
        { id: createId('rule'), keyword: 'alcohol', category: 'all', severity: 'block', reason: 'Alcohol is restricted.' },
        { id: createId('rule'), keyword: 'medical', category: 'health', severity: 'review', reason: 'Medical claims require manual review.' },
        { id: createId('rule'), keyword: 'sleep positioner', category: 'baby', severity: 'block', reason: 'Baby sleep safety risk.' },
        { id: createId('rule'), keyword: 'weapon', category: 'all', severity: 'block', reason: 'Weapons are prohibited.' },
        { id: createId('rule'), keyword: 'battery acid', category: 'all', severity: 'block', reason: 'Hazardous liquid battery products are blocked.' },
        { id: createId('rule'), keyword: 'supplement', category: 'health', severity: 'block', reason: 'Supplements are not allowed in v1.' },
    ];
}
export function seedVeroRules() {
    return [
        { id: createId('vero'), brand: 'Apple', keyword: 'magsafe', pattern: 'apple|magsafe', reason: 'Avoid Apple trademark and accessory compatibility risk.', severity: 'review' },
        { id: createId('vero'), brand: 'Disney', keyword: 'disney', pattern: 'disney|marvel|star wars', reason: 'Licensed IP requires manual approval.', severity: 'block' },
        { id: createId('vero'), brand: 'Nike', keyword: 'nike', pattern: 'nike|jordan', reason: 'High VeRO exposure.', severity: 'block' },
    ];
}
export function evaluatePolicy(product, prohibitedRules, veroRules) {
    const haystack = normalizeKeyword(`${product.title} ${product.categoryPath} ${product.tags.join(' ')}`);
    const matches = [];
    let state = 'clear';
    for (const rule of prohibitedRules) {
        if (haystack.includes(normalizeKeyword(rule.keyword))) {
            matches.push(`${rule.reason} (${rule.keyword})`);
            state = rule.severity === 'block' ? 'blocked' : state === 'clear' ? 'review' : state;
        }
    }
    for (const rule of veroRules) {
        const pattern = new RegExp(rule.pattern, 'i');
        if (pattern.test(haystack)) {
            matches.push(`${rule.reason} (${rule.brand})`);
            state = rule.severity === 'block' ? 'blocked' : state === 'clear' ? 'review' : state;
        }
    }
    return { state, matches };
}
