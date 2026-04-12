const puppeteer = require('puppeteer');

(async () => {
    console.log("Starting Puppeteer UI test...");
    const browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();
    
    // Set viewport to a reasonable size
    await page.setViewport({ width: 1280, height: 800 });

    page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
    page.on('pageerror', error => console.error('BROWSER ERROR:', error.message));

    try {
        await page.goto('http://localhost:3005', { waitUntil: 'networkidle0', timeout: 30000 });
        console.log("Page loaded successfully.");

        // Wait for React to render the main input field instead of the canvas class
        await page.waitForSelector('input[placeholder="Enter core task (e.g. Architect a scalable microservice)..."]', { timeout: 10000 });
        console.log("React UI loaded.");

        // Type a prompt
        await page.type('input[placeholder="Enter core task (e.g. Architect a scalable microservice)..."]', 'What is the sum of 10 and 20?');
        console.log("Entered master prompt.");

        // Click execute
        await page.click('button.btn-primary');
        console.log("Clicked Execute Pipeline.");

        // Wait for the consensus text box to appear
        console.log("Waiting for backend API synthesis response...");
        await page.waitForSelector('#results-panel', { timeout: 30000 });
        console.log("Processing finished. Results panel found.");

        const consensusContent = await page.$eval('#results-panel p', el => el.innerText);
        console.log("\n--- TEST SUCCESS: SYNTHESIS OUTPUT ---");
        console.log(consensusContent);
        console.log("--------------------------------------\n");

        await page.screenshot({ path: 'C:\\Users\\Administrator\\.gemini\\antigravity\\brain\\bafb4143-2e37-4ae7-b612-4861efebf605\\puppeteer_ui_test.png' });
        console.log("Screenshot saved to artifacts.");
    } catch (err) {
        console.error("Test failed: ", err);
        await page.screenshot({ path: 'C:\\Users\\Administrator\\.gemini\\antigravity\\brain\\bafb4143-2e37-4ae7-b612-4861efebf605\\puppeteer_ui_error.png' });
    } finally {
        await browser.close();
        console.log("Browser closed.");
    }
})();
