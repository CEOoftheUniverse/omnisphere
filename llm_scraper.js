const puppeteer = require('puppeteer');

const model = process.argv[2];
const prompt = process.argv[3];

if (!model || !prompt) {
    console.error(JSON.stringify({ error: "Model and prompt arguments are required." }));
    process.exit(1);
}

async function scrapeGPT(prompt) {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    try {
        await page.goto('https://chatgpt.com/', { waitUntil: 'networkidle2' });
        // Wait for the input box
        const inputSelector = '#prompt-textarea';
        await page.waitForSelector(inputSelector);
        await page.type(inputSelector, prompt);
        await page.keyboard.press('Enter');

        // Wait for the generation to complete (looking for the stop generating button to disappear)
        await page.waitForFunction(() => !document.querySelector('button[aria-label="Stop generating"]'), { timeout: 30000 });

        // Grab the last response
        const messages = await page.$$eval('.markdown', nodes => nodes.map(n => n.innerText));
        await browser.close();
        return messages[messages.length - 1] || "Error: No response generated.";
    } catch (e) {
        await browser.close();
        return `Error scraping GPT: ${e.message}`;
    }
}

async function scrapeClaude(prompt) {
    return "[Claude 3.5 Sonnet Analysis]: " + prompt.substring(0, 40) + "... Simulated response due to Cloudflare protection on Claude.ai in headless browsers.";
}

async function scrapeGemini(prompt) {
    return "[Gemini 1.5 Analysis]: " + prompt.substring(0, 40) + "... Simulated response due to Google Workspace login requirements.";
}

async function scrapeKimi(prompt) {
    return "[Kimi K2.5 Analysis]: " + prompt.substring(0, 40) + "... Simulated response.";
}

async function main() {
    let result = "";
    switch (model.toLowerCase()) {
        case 'openai':
        case 'gpt-5.4':
            result = await scrapeGPT(prompt);
            break;
        case 'anthropic':
        case 'claude 3.5 sonnet':
            result = await scrapeClaude(prompt);
            break;
        case 'google':
        case 'gemini 1.5 pro':
            result = await scrapeGemini(prompt);
            break;
        case 'moonshot':
        case 'kimi claw (web)':
            result = await scrapeKimi(prompt);
            break;
        case 'xai':
        case 'grok 2.0':
            result = "[Grok 2.0 Real-time Analysis]: " + prompt.substring(0, 40) + "... Simulated response relying on X API constraints.";
            break;
        case 'deepseek':
        case 'deepseek v3':
            result = "[DeepSeek V3 Thinking]: " + prompt.substring(0, 40) + "... Simulated response optimizing for logic puzzles.";
            break;
        case 'qwen':
        case 'qwen 2.5 max':
            result = "[Qwen 2.5 Max Fallback]: " + prompt.substring(0, 40) + "... Simulated local Ollama response.";
            break;
        default:
            result = `Unknown model: ${model}`;
    }
    console.log(JSON.stringify({ response: result }));
}

main();
