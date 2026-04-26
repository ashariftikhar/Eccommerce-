import { createId, daysFromNow, median, normalizeKeyword, nowIso, round, shortHash } from './utils';
function deterministicNumber(seed, min, max) {
    const total = [...seed].reduce((sum, char) => sum + char.charCodeAt(0), 0);
    const span = max - min;
    return min + (total % Math.max(1, span + 1));
}
function syntheticCatalog(limit) {
    const seeds = [
        'under desk cable organizer',
        'mini heatless curl band',
        'stainless soap dispenser',
        'magnetic spice rack',
        'drawer compartment bins',
        'portable pill organizer',
        'shoe crease protector',
        'luggage cup holder',
        'sink splash guard',
        'car seat gap filler',
        'pet grooming glove',
        'travel compression bags',
        'vegetable chopper slicer',
        'reusable lint remover',
        'cordless milk frother',
    ];
    return seeds.slice(0, limit).map((seed, index) => {
        const landedCost = round(3.5 + index * 0.35, 2);
        const shippingCost = round(1 + (index % 3) * 0.45, 2);
        return {
            id: `cj_${index + 1}`,
            variantId: `cjv_${index + 1}`,
            title: seed.replace(/\b\w/g, (match) => match.toUpperCase()),
            normalizedKeyword: normalizeKeyword(seed),
            categoryPath: index % 4 === 0 ? 'Home & Garden > Storage & Organization' : index % 4 === 1 ? 'Health & Beauty > Personal Care' : index % 4 === 2 ? 'Travel > Accessories' : 'Pet Supplies > Grooming',
            warehouseCountry: 'US',
            landedCost: round(landedCost + shippingCost, 2),
            shippingCost,
            stock: 30 + index * 8,
            estimatedDeliveryBusinessDays: 2 + (index % 4),
            supplierName: `CJ Supplier ${index + 1}`,
            supplierAgeDays: 160 + index * 18,
            shippingConsistency: 78 + (index % 5) * 4,
            stockStability: 76 + (index % 6) * 3,
            orderHistoryScore: 74 + (index % 4) * 5,
            imageUrl: `https://picsum.photos/seed/${encodeURIComponent(seed)}/640/640`,
            tags: index % 3 === 0 ? ['utility', 'simple', 'lightweight'] : index % 3 === 1 ? ['beauty', 'travel', 'giftable'] : ['home', 'problem-solving', 'storage'],
        };
    });
}
export class CJClient {
    constructor(config) {
        this.config = config;
    }
    async fetchCatalog(limit) {
        if (!this.config.cj.accessToken || !this.config.cj.apiKey) {
            return syntheticCatalog(Math.min(limit, 15));
        }
        const response = await fetch(`${this.config.cj.apiBaseUrl}/product/list?limit=${limit}`, {
            headers: {
                'CJ-Access-Token': this.config.cj.accessToken,
                'CJ-Api-Key': this.config.cj.apiKey,
            },
        });
        if (!response.ok) {
            throw new Error(`CJ catalog request failed with ${response.status}`);
        }
        const payload = (await response.json());
        const records = Array.isArray(payload.data) ? payload.data : [];
        return records.slice(0, limit).map((record, index) => ({
            id: String(record.pid || record.productId || `cj_${index}`),
            variantId: String(record.vid || record.variantId || `cjv_${index}`),
            title: String(record.productName || record.title || `CJ Item ${index + 1}`),
            normalizedKeyword: normalizeKeyword(String(record.productName || record.title || `CJ Item ${index + 1}`)),
            categoryPath: String(record.categoryName || record.categoryPath || 'General'),
            warehouseCountry: String(record.warehouseCountry || record.countryCode || 'US'),
            landedCost: Number(record.sellPrice || record.cost || 0),
            shippingCost: Number(record.shippingFee || 0),
            stock: Number(record.sellableQuantity || record.stock || 0),
            estimatedDeliveryBusinessDays: Number(record.deliveryDays || record.deliveryTime || 7),
            supplierName: String(record.supplierName || 'CJ Supplier'),
            supplierAgeDays: Number(record.supplierAgeDays || 180),
            shippingConsistency: Number(record.shippingConsistency || 80),
            stockStability: Number(record.stockStability || 80),
            orderHistoryScore: Number(record.orderHistoryScore || 80),
            imageUrl: String(record.image || record.productImage || ''),
            tags: Array.isArray(record.tags) ? record.tags.map(String) : [],
        }));
    }
    async getStock(productId, variantId) {
        if (!this.config.cj.accessToken || !this.config.cj.apiKey) {
            return {
                stock: deterministicNumber(`${productId}:${variantId}`, 12, 80),
                etaBusinessDays: deterministicNumber(`${variantId}:${productId}`, 2, 5),
            };
        }
        const response = await fetch(`${this.config.cj.apiBaseUrl}/product/query?pid=${productId}&vid=${variantId}`, {
            headers: {
                'CJ-Access-Token': this.config.cj.accessToken,
                'CJ-Api-Key': this.config.cj.apiKey,
            },
        });
        if (!response.ok) {
            throw new Error(`CJ stock request failed with ${response.status}`);
        }
        const payload = (await response.json());
        return {
            stock: Number(payload.data?.sellableQuantity || payload.data?.stock || 0),
            etaBusinessDays: Number(payload.data?.deliveryDays || payload.data?.deliveryTime || 7),
        };
    }
    async placeOrder(params) {
        if (!this.config.cj.accessToken || !this.config.cj.apiKey) {
            return { cjOrderId: `SIM-CJ-${shortHash(params.idempotencyKey)}` };
        }
        const response = await fetch(`${this.config.cj.apiBaseUrl}/order/create`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'CJ-Access-Token': this.config.cj.accessToken,
                'CJ-Api-Key': this.config.cj.apiKey,
            },
            body: JSON.stringify(params),
        });
        if (!response.ok) {
            throw new Error(`CJ order placement failed with ${response.status}`);
        }
        const payload = (await response.json());
        return { cjOrderId: payload.data?.orderId || `CJ-${shortHash(params.idempotencyKey)}` };
    }
}
export class EbayClient {
    constructor(config) {
        this.config = config;
    }
    get appId() {
        return this.config.ebay.env === 'sandbox' ? this.config.ebay.sandboxClientId || this.config.ebay.clientId : this.config.ebay.clientId;
    }
    async getMarketSnapshot(keyword) {
        if (!this.appId) {
            const sold30d = deterministicNumber(keyword, 18, 120);
            const sold7d = deterministicNumber(`7:${keyword}`, 4, 28);
            const uniqueSellers30d = deterministicNumber(`sellers:${keyword}`, 4, 22);
            const activeCount = deterministicNumber(`active:${keyword}`, 15, 180);
            const topRatedCount = deterministicNumber(`top:${keyword}`, 2, Math.max(2, Math.floor(activeCount / 2)));
            return {
                sold30d,
                sold7d,
                uniqueSellers30d,
                medianSoldPrice30d: round(deterministicNumber(`price:${keyword}`, 14, 26) + 0.99, 2),
                activeCount,
                topRatedCount,
                eliteShare: round(topRatedCount / Math.max(1, activeCount), 2),
                competitionRatio: round(activeCount / Math.max(1, sold30d), 2),
                capturedAt: nowIso(),
            };
        }
        const findingBase = this.config.ebay.env === 'sandbox'
            ? 'https://svcs.sandbox.ebay.com/services/search/FindingService/v1'
            : 'https://svcs.ebay.com/services/search/FindingService/v1';
        const headers = {
            'X-EBAY-SOA-SECURITY-APPNAME': this.appId,
            'X-EBAY-SOA-RESPONSE-DATA-FORMAT': 'JSON',
            'X-EBAY-SOA-GLOBAL-ID': 'EBAY-US',
        };
        const completedUrl = new URL(findingBase);
        completedUrl.searchParams.set('OPERATION-NAME', 'findCompletedItems');
        completedUrl.searchParams.set('SERVICE-VERSION', '1.13.0');
        completedUrl.searchParams.set('keywords', keyword);
        completedUrl.searchParams.set('paginationInput.entriesPerPage', '50');
        completedUrl.searchParams.set('itemFilter(0).name', 'SoldItemsOnly');
        completedUrl.searchParams.set('itemFilter(0).value', 'true');
        completedUrl.searchParams.set('itemFilter(1).name', 'ListingType');
        completedUrl.searchParams.set('itemFilter(1).value(0)', 'FixedPrice');
        completedUrl.searchParams.set('itemFilter(2).name', 'LocatedIn');
        completedUrl.searchParams.set('itemFilter(2).value', 'US');
        completedUrl.searchParams.set('itemFilter(3).name', 'Condition');
        completedUrl.searchParams.set('itemFilter(3).value', '1000');
        const activeUrl = new URL(findingBase);
        activeUrl.searchParams.set('OPERATION-NAME', 'findItemsAdvanced');
        activeUrl.searchParams.set('SERVICE-VERSION', '1.13.0');
        activeUrl.searchParams.set('keywords', keyword);
        activeUrl.searchParams.set('paginationInput.entriesPerPage', '50');
        activeUrl.searchParams.set('itemFilter(0).name', 'ListingType');
        activeUrl.searchParams.set('itemFilter(0).value(0)', 'FixedPrice');
        activeUrl.searchParams.set('itemFilter(1).name', 'LocatedIn');
        activeUrl.searchParams.set('itemFilter(1).value', 'US');
        const [completedResponse, activeResponse] = await Promise.all([fetch(completedUrl, { headers }), fetch(activeUrl, { headers })]);
        if (!completedResponse.ok || !activeResponse.ok) {
            throw new Error(`eBay finding request failed (${completedResponse.status}/${activeResponse.status})`);
        }
        const completedPayload = (await completedResponse.json());
        const activePayload = (await activeResponse.json());
        const completedItems = extractFindingItems(completedPayload);
        const activeItems = extractFindingItems(activePayload);
        const soldPrices = completedItems.map((item) => item.price).filter((value) => Number.isFinite(value));
        const uniqueSellers = new Set(completedItems.map((item) => item.seller).filter(Boolean));
        const sold30d = completedItems.length;
        const sold7d = completedItems.filter((item) => Date.now() - item.endTime.getTime() <= 7 * 24 * 60 * 60 * 1000).length;
        const topRatedCount = activeItems.filter((item) => item.topRated).length;
        const activeCount = activeItems.length;
        return {
            sold30d,
            sold7d,
            uniqueSellers30d: uniqueSellers.size,
            medianSoldPrice30d: round(median(soldPrices), 2),
            activeCount,
            topRatedCount,
            eliteShare: round(topRatedCount / Math.max(1, activeCount), 2),
            competitionRatio: round(activeCount / Math.max(1, sold30d), 2),
            capturedAt: nowIso(),
        };
    }
    async validateCategoryPolicies(candidate) {
        const warnings = [];
        const categoryId = mapCategoryId(candidate.categoryPath);
        if (!this.appId) {
            if (candidate.tags.some((tag) => tag.toLowerCase().includes('battery'))) {
                warnings.push('Battery-adjacent item requires manual category review.');
            }
            return { valid: warnings.length === 0, warnings, categoryId };
        }
        const base = this.config.ebay.env === 'sandbox' ? 'https://apim.sandbox.ebay.com' : 'https://apim.ebay.com';
        const response = await fetch(`${base}/sell/metadata/v1/marketplace/EBAY_US/get_category_policies?category_id=${categoryId}`);
        if (!response.ok) {
            warnings.push(`Metadata policy lookup returned ${response.status}.`);
            return { valid: false, warnings, categoryId };
        }
        const payload = (await response.json());
        const allowed = Boolean(payload.categoryId || payload.categoryPolicies);
        if (!allowed) {
            warnings.push('Category policies could not be validated.');
        }
        return { valid: allowed, warnings, categoryId };
    }
    async createOrReplaceInventoryItem(draft) {
        return { inventoryItemId: `INV-${draft.sellerSku}` };
    }
    async publishOffer(draft) {
        return {
            offerId: `OFFER-${shortHash(`${draft.sellerSku}:${draft.price}:${draft.categoryId}`)}`,
            publishedAt: nowIso(),
        };
    }
    async updateInventoryQuantity(sellerSku, quantity) {
        void sellerSku;
        void quantity;
    }
    async withdrawOffer(offerId) {
        void offerId;
    }
}
function extractFindingItems(payload) {
    const root = Object.values(payload)[0];
    const payloadRoot = root?.[0] || {};
    const searchResult = payloadRoot.searchResult?.[0];
    const items = searchResult?.item || [];
    return items.map((item) => {
        const sellingStatus = item.sellingStatus?.[0] || {};
        const currentPrice = sellingStatus.currentPrice?.[0];
        const sellerInfo = item.sellerInfo?.[0] || {};
        const listingInfo = item.listingInfo?.[0] || {};
        return {
            price: Number(currentPrice?.__value__ || currentPrice?.value || 0),
            seller: String(sellerInfo.sellerUserName?.[0] || ''),
            endTime: new Date(String(listingInfo.endTime?.[0] || nowIso())),
            topRated: sellerInfo.topRatedSeller?.[0] === 'true',
        };
    });
}
function mapCategoryId(categoryPath) {
    const lowered = categoryPath.toLowerCase();
    if (lowered.includes('storage')) {
        return '20635';
    }
    if (lowered.includes('travel')) {
        return '300';
    }
    if (lowered.includes('pet')) {
        return '177';
    }
    return '11700';
}
export class AIClient {
    constructor(config) {
        this.config = config;
    }
    providerDetails(provider) {
        if (provider === 'deepseek') {
            return { provider, modelName: this.config.ai.deepseekModel };
        }
        if (provider === 'gemini') {
            return { provider, modelName: this.config.ai.geminiModel };
        }
        return { provider: 'system', modelName: null };
    }
    canSpend(state) {
        const budgets = state.budgets;
        const month = nowIso().slice(0, 7);
        const day = nowIso().slice(0, 10);
        if (budgets.currentMonth !== month) {
            budgets.currentMonth = month;
            budgets.monthToDateUsd = 0;
            budgets.aiFallbackMode = false;
        }
        if (budgets.currentDay !== day) {
            budgets.currentDay = day;
            budgets.dayToDateUsd = 0;
        }
        return budgets.monthToDateUsd < budgets.monthlyCapUsd && budgets.dayToDateUsd < budgets.dailyCapUsd && !budgets.aiFallbackMode;
    }
    charge(state, usd) {
        state.budgets.monthToDateUsd = round(state.budgets.monthToDateUsd + usd, 4);
        state.budgets.dayToDateUsd = round(state.budgets.dayToDateUsd + usd, 4);
        if (state.budgets.monthToDateUsd >= state.budgets.monthlyCapUsd || state.budgets.dayToDateUsd >= state.budgets.dailyCapUsd) {
            state.budgets.aiFallbackMode = true;
        }
    }
    findCache(state, productFingerprint, kind) {
        const now = Date.now();
        return state.aiCache.find((entry) => entry.productFingerprint === productFingerprint && entry.kind === kind && new Date(entry.expiresAt).getTime() > now) || null;
    }
    async generateListingPack(state, productFingerprint, candidate) {
        const cached = this.findCache(state, productFingerprint, 'listing_pack');
        if (cached) {
            return {
                pack: JSON.parse(cached.payload),
                provider: cached.provider,
                modelName: this.providerDetails(cached.provider).modelName,
                cacheHit: true,
                fallback: cached.provider === 'system',
            };
        }
        let pack;
        let provider = 'system';
        if (this.canSpend(state) && this.config.ai.deepseekApiKey) {
            pack = await this.generateViaDeepSeek(candidate);
            provider = 'deepseek';
            this.charge(state, 0.03);
        }
        else if (this.canSpend(state) && this.config.ai.geminiApiKey) {
            pack = await this.generateViaGemini(candidate);
            provider = 'gemini';
            this.charge(state, 0.05);
        }
        else {
            pack = templateListingPack(candidate);
        }
        state.aiCache.unshift({
            id: createId('cache'),
            productFingerprint,
            kind: 'listing_pack',
            provider,
            payload: JSON.stringify(pack),
            expiresAt: daysFromNow(30),
            createdAt: nowIso(),
        });
        state.aiCache = state.aiCache.slice(0, 200);
        return {
            pack,
            provider,
            modelName: this.providerDetails(provider).modelName,
            cacheHit: false,
            fallback: provider === 'system',
        };
    }
    async generateCeoReply(state, prompt) {
        let provider = 'system';
        let modelName = null;
        let content = '';
        if (this.canSpend(state) && this.config.ai.deepseekApiKey) {
            provider = 'deepseek';
            modelName = this.config.ai.deepseekModel;
            content = await this.generateShortReplyViaDeepSeek(prompt);
            if (content) {
                this.charge(state, 0.02);
            }
        }
        if (!content && this.canSpend(state) && this.config.ai.geminiApiKey) {
            provider = 'gemini';
            modelName = this.config.ai.geminiModel;
            content = await this.generateShortReplyViaGemini(prompt);
            if (content) {
                this.charge(state, 0.03);
            }
        }
        if (!content) {
            provider = 'system';
            modelName = null;
            content = `Manager summary: ${prompt}. Current mode remains visibility-first. Review the latest agent traces before enabling wider automation.`;
        }
        return {
            message: {
                id: createId('msg'),
                sender: 'ceo',
                direction: 'outbound',
                message: content,
                createdAt: nowIso(),
                provider,
                modelName,
                linkedExecutionId: null,
            },
            fallback: provider === 'system',
        };
    }
    async generateViaDeepSeek(candidate) {
        const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.config.ai.deepseekApiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: this.config.ai.deepseekModel,
                response_format: { type: 'json_object' },
                messages: [
                    {
                        role: 'system',
                        content: 'You write concise eBay listing packs for US consumers. Return JSON with title, subtitle, description, bullets, itemSpecifics, images.',
                    },
                    {
                        role: 'user',
                        content: `Create a listing pack for ${candidate.title} in category ${candidate.categoryPath} with target price ${candidate.targetPrice}.`,
                    },
                ],
            }),
        });
        if (!response.ok) {
            return templateListingPack(candidate);
        }
        const payload = (await response.json());
        const content = payload.choices?.[0]?.message?.content;
        if (!content) {
            return templateListingPack(candidate);
        }
        try {
            return JSON.parse(content);
        }
        catch {
            return templateListingPack(candidate);
        }
    }
    async generateViaGemini(candidate) {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.config.ai.geminiModel}:generateContent?key=${this.config.ai.geminiApiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [
                    {
                        parts: [
                            {
                                text: `Return JSON with title, subtitle, description, bullets, itemSpecifics, images for a US eBay listing about ${candidate.title} in ${candidate.categoryPath}.`,
                            },
                        ],
                    },
                ],
                generationConfig: { responseMimeType: 'application/json' },
            }),
        });
        if (!response.ok) {
            return templateListingPack(candidate);
        }
        const payload = (await response.json());
        const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
            return templateListingPack(candidate);
        }
        try {
            return JSON.parse(text);
        }
        catch {
            return templateListingPack(candidate);
        }
    }
    async generateShortReplyViaDeepSeek(prompt) {
        try {
            const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.config.ai.deepseekApiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: this.config.ai.deepseekModel,
                    messages: [
                        {
                            role: 'system',
                            content: 'You are a concise ecommerce operations manager. Reply in 2-4 short sentences.',
                        },
                        {
                            role: 'user',
                            content: prompt,
                        },
                    ],
                }),
            });
            if (!response.ok) {
                return '';
            }
            const payload = (await response.json());
            return payload.choices?.[0]?.message?.content?.trim() || '';
        }
        catch {
            return '';
        }
    }
    async generateShortReplyViaGemini(prompt) {
        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.config.ai.geminiModel}:generateContent?key=${this.config.ai.geminiApiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [
                        {
                            parts: [{ text: `Reply in 2-4 short sentences as an ecommerce ops manager. Prompt: ${prompt}` }],
                        },
                    ],
                }),
            });
            if (!response.ok) {
                return '';
            }
            const payload = (await response.json());
            return payload.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        }
        catch {
            return '';
        }
    }
}
function templateListingPack(candidate) {
    const headline = candidate.title.length > 72 ? candidate.title.slice(0, 69).trimEnd() + '...' : candidate.title;
    return {
        title: `${headline} | US Fast Ship`,
        subtitle: 'Smart buy, everyday value.',
        description: `${candidate.title} is a simple, useful product selected for YuziGoods because it offers practical value, clean presentation, and reliable US delivery. Ships fast from a US warehouse.`,
        bullets: [
            'US warehouse fulfillment with fast delivery promise',
            'Simple, useful everyday product with low-friction setup',
            'Selected for margin, delivery speed, and low return risk',
            'Packed for YuziGoods US-first marketplace workflow',
        ],
        itemSpecifics: {
            Brand: 'YuziGoods',
            Type: candidate.categoryPath.split('>').slice(-1)[0]?.trim() || 'General',
            Color: 'As pictured',
            Material: 'Mixed materials',
            Country: 'United States warehouse',
        },
        images: [candidate.imageUrl],
    };
}
