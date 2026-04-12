/**
 * Smart Router — Intelligent model selection with health tracking
 * Tracks which models are healthy and routes around failures automatically
 */

class SmartRouter {
    constructor() {
        this.health = new Map(); // model -> { healthy, lastError, failCount, lastSuccess, avgLatency }
        this.FAILURE_THRESHOLD = 3; // consecutive failures before marking unhealthy
        this.RECOVERY_INTERVAL = 300_000; // 5 min before retrying unhealthy model
    }

    isHealthy(model) {
        const h = this.health.get(model);
        if (!h) return true; // unknown = assume healthy
        if (h.healthy) return true;
        // Allow retry after recovery interval
        return (Date.now() - h.lastError) > this.RECOVERY_INTERVAL;
    }

    recordSuccess(model, latencyMs) {
        const h = this.health.get(model) || { healthy: true, failCount: 0, successes: 0, avgLatency: 0 };
        h.healthy = true;
        h.failCount = 0;
        h.successes++;
        h.lastSuccess = Date.now();
        h.avgLatency = h.avgLatency ? (h.avgLatency * 0.8 + latencyMs * 0.2) : latencyMs;
        this.health.set(model, h);
    }

    recordFailure(model, error) {
        const h = this.health.get(model) || { healthy: true, failCount: 0, successes: 0, avgLatency: 0 };
        h.failCount++;
        h.lastError = Date.now();
        h.lastErrorMsg = error;
        if (h.failCount >= this.FAILURE_THRESHOLD) h.healthy = false;
        this.health.set(model, h);
    }

    /**
     * Select best models from a tier, excluding unhealthy ones
     * Falls back to next-cheapest healthy model if primary is down
     */
    selectModels(tier, allModels, costTiers, count = 3) {
        const tierModels = costTiers[tier] || costTiers.balanced;
        const healthy = tierModels.filter(m => this.isHealthy(m));
        
        if (healthy.length >= count) return healthy.slice(0, count);
        
        // Not enough healthy models in tier — pull from other tiers
        const allAvailable = Object.values(costTiers).flat()
            .filter((m, i, a) => a.indexOf(m) === i) // unique
            .filter(m => this.isHealthy(m) && !healthy.includes(m));
        
        return [...healthy, ...allAvailable].slice(0, count);
    }

    getStatus() {
        const status = {};
        for (const [model, h] of this.health) {
            status[model] = {
                healthy: h.healthy,
                failCount: h.failCount,
                successes: h.successes || 0,
                avgLatency: Math.round(h.avgLatency || 0),
                lastError: h.lastErrorMsg,
            };
        }
        return status;
    }
}

module.exports = SmartRouter;
