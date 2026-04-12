# Omnisphere — Multi-LLM Arbitrage Router

**One API. 8 models. 70% cheaper than direct.**

Omnisphere routes AI queries through Claude, GPT, Gemini, MiniMax, and DeepSeek — automatically picking the cheapest model that meets quality requirements. OpenAI-compatible drop-in replacement.

🌐 **Live:** [ceooftheuniverse.github.io/omnisphere](https://ceooftheuniverse.github.io/omnisphere/)  
📖 **Docs:** [API Documentation](https://ceooftheuniverse.github.io/omnisphere/docs.html)

## Features

- **OpenAI-compatible** `/v1/chat/completions` — change one URL, save 70%
- **8 models** across 5 providers (Anthropic, OpenAI, Google, MiniMax, DeepSeek)
- **4 cost tiers:** ultraCheap ($0.0001), cheap, balanced ($0.003), premium ($0.01)
- **Smart routing** — auto-detects prompt complexity, routes to optimal model
- **Multi-model consensus** — query 3+ models simultaneously, get weighted synthesis
- **SmartRouter health tracking** — auto-routes around failing providers
- **OpenRouter fallback** — universal backup when direct APIs fail
- **API key auth** with per-key rate limiting and budget caps
- **Usage metering** — track spend per model, per day, per key
- **Admin dashboard** — `/admin/keys`, `/admin/revenue`
- **SQLite metrics** — every call tracked (cost, latency, tokens, success)

## Quick Start

```bash
# Install dependencies
npm install

# Set at least one API key
export ANTHROPIC_API_KEY=sk-ant-...

# Optional: more providers = more models live
export OPENAI_API_KEY=sk-...
export GOOGLE_API_KEY=AIza...
export OPENROUTER_API_KEY=sk-or-...    # Universal fallback
export MINIMAX_API_KEY=...
export DEEPSEEK_API_KEY=...

# Start
node server.js
```

## Usage

```bash
# OpenAI-compatible (drop-in replacement)
curl -X POST http://localhost:3005/v1/chat/completions \
  -H "Authorization: Bearer omni_your_key" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4","messages":[{"role":"user","content":"Hello"}]}'

# Auto-routed (picks cheapest viable model)
curl -X POST http://localhost:3005/api/query \
  -H "Authorization: Bearer omni_your_key" \
  -d '{"prompt":"What is 2+2?","tier":"ultraCheap"}'

# Multi-model consensus
curl -X POST http://localhost:3005/api/consensus \
  -H "Authorization: Bearer omni_your_key" \
  -d '{"prompt":"Compare React vs Vue","tier":"premium"}'
```

## Architecture

```
Client Request
    │
    ▼
┌─────────────────┐
│   Auth + Rate    │  API key validation, rate limits, budget check
│   Limiting       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Smart Router    │  Complexity detection → tier selection
│  + Health Track  │  Routes around unhealthy providers
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐ ┌────────┐
│Direct  │ │OpenRtr │  Fallback chain:
│API Call│ │Fallback│  Direct → OpenRouter → Demo
└────┬───┘ └────┬───┘
     │          │
     ▼          ▼
┌─────────────────┐
│  SQLite Metrics  │  Log every call: cost, latency, tokens
│  + Usage Meter   │
└─────────────────┘
```

## Models & Pricing

| Model | Provider | Input $/M | Output $/M | Quality |
|-------|----------|-----------|------------|---------|
| claude-sonnet-4 | Anthropic | $3.00 | $15.00 | ⭐9 |
| claude-haiku-3.5 | Anthropic | $0.80 | $4.00 | ⭐7 |
| gpt-4o-mini | OpenAI | $0.15 | $0.60 | ⭐7 |
| gpt-4o | OpenAI | $2.50 | $10.00 | ⭐9 |
| gemini-2.0-flash | Google | $0.075 | $0.30 | ⭐7 |
| gemini-2.5-pro | Google | $1.25 | $5.00 | ⭐9 |
| minimax-m2.5 | MiniMax | $0.11 | $0.11 | ⭐8 |
| deepseek-v3.2 | DeepSeek | $0.14 | $0.28 | ⭐8 |

## Part of MoltBot Cloud

Omnisphere powers the multi-LLM routing for [MoltBot Cloud](https://ceooftheuniverse.github.io/vmsaas-live/) — AI agent VMs pre-installed and ready in 60 seconds.

## License

MIT
