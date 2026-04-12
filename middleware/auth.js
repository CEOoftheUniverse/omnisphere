/**
 * API Key Authentication + Rate Limiting + Usage Metering
 * For Omnisphere customers using /v1/chat/completions
 */

const path = require('path');
const fs = require('fs');

const KEYS_FILE = path.join(__dirname, '..', 'data', 'api_keys.json');

// In-memory rate limiter
const rateLimits = new Map(); // key -> { count, resetAt }
const RATE_LIMIT_WINDOW = 60_000; // 1 minute
const RATE_LIMIT_MAX = 60; // 60 requests per minute per key

function loadKeys() {
    try { return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8')); } catch { return {}; }
}

function saveKeys(keys) {
    const dir = path.dirname(KEYS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2));
}

/**
 * Generate a new API key
 */
function generateKey(name, tier = 'free', monthlyBudget = 1.0) {
    const keys = loadKeys();
    const key = `omni_${require('crypto').randomBytes(24).toString('hex')}`;
    keys[key] = {
        name,
        tier, // free, pro, enterprise
        monthlyBudget, // USD
        monthlySpend: 0,
        totalSpend: 0,
        totalCalls: 0,
        rateLimit: tier === 'enterprise' ? 300 : tier === 'pro' ? 120 : 60,
        createdAt: new Date().toISOString(),
        lastUsed: null,
        active: true,
    };
    saveKeys(keys);
    return { key, ...keys[key] };
}

/**
 * Auth middleware — validates API key, checks rate limit, tracks usage
 */
function authMiddleware(req, res, next) {
    // Public/admin endpoints don't need API key auth
    const publicPaths = ['/api/status', '/api/pricing', '/v1/models', '/'];
    if (publicPaths.some(p => req.path === p || req.path.startsWith('/api/metrics') || req.path.startsWith('/admin'))) return next();

    const authHeader = req.headers.authorization;
    const key = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : req.query.key;

    // Allow unauthenticated access in demo mode (no keys file)
    if (!key) {
        if (!fs.existsSync(KEYS_FILE)) {
            req.apiKey = { tier: 'demo', rateLimit: 10 };
            return next();
        }
        return res.status(401).json({ error: { message: 'API key required. Set Authorization: Bearer omni_xxx', type: 'auth_error' } });
    }

    const keys = loadKeys();
    const keyData = keys[key];
    if (!keyData || !keyData.active) {
        return res.status(401).json({ error: { message: 'Invalid or deactivated API key', type: 'auth_error' } });
    }

    // Rate limiting
    const now = Date.now();
    const limit = rateLimits.get(key) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
    if (now > limit.resetAt) { limit.count = 0; limit.resetAt = now + RATE_LIMIT_WINDOW; }
    limit.count++;
    rateLimits.set(key, limit);

    if (limit.count > (keyData.rateLimit || RATE_LIMIT_MAX)) {
        return res.status(429).json({ error: { message: `Rate limit exceeded (${keyData.rateLimit}/min). Upgrade tier for higher limits.`, type: 'rate_limit' } });
    }

    // Budget check
    if (keyData.monthlySpend >= keyData.monthlyBudget) {
        return res.status(402).json({ error: { message: `Monthly budget exhausted ($${keyData.monthlySpend.toFixed(4)}/$${keyData.monthlyBudget}). Top up or upgrade.`, type: 'budget_exceeded' } });
    }

    req.apiKey = keyData;
    req.apiKeyId = key;

    // Track usage after response
    res.on('finish', () => {
        const cost = parseFloat(res.getHeader('x-cost') || '0');
        if (cost > 0) {
            keyData.monthlySpend += cost;
            keyData.totalSpend += cost;
            keyData.totalCalls++;
            keyData.lastUsed = new Date().toISOString();
            saveKeys(keys);
        }
    });

    next();
}

module.exports = { authMiddleware, generateKey, loadKeys, saveKeys };
