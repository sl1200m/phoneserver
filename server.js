const fastify = require('fastify')({ logger: false });
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const mysql = require('mysql2/promise');
const dns = require('dns').promises;

puppeteer.use(StealthPlugin());

// --- CONFIGURATION ---
const DB_CONFIG = {
    host: '174.138.22.138',
    user: 'dbUser200mWebsite',
    password: 'ZjdtMhjoj8rczpqEYM8j',
    database: 'db200mWebsite'
};

const WEB_SERVER_RECEIVER = 'https://200m.website/api/receiver.php';
const TERMUX_CHROMIUM = '/data/data/com.termux/files/usr/bin/chromium';
const BLOCK_IPS = ["125.160.17.84", "36.86.63.185", "118.97.115.30", "103.111.1.1"];

/**
 * CORE LOGIC 1: Puppeteer Browser Check (CAPTCHAs & WAF)
 */
async function getBrowserStatus(targetUrl) {
    // const browser = await puppeteer.launch({
    //     executablePath: TERMUX_CHROMIUM,
    //     headless: "new",
    //     args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    // });
    const browser = await puppeteer.launch({
        executablePath: '/data/data/com.termux/files/usr/bin/chromium',
        headless: "new",
        args: [
            '--no-sandbox',               // Required for Termux
            '--disable-setuid-sandbox', 
            '--disable-dev-shm-usage',    // Prevents memory crashes on phones
            '--disable-gpu', 
            '--no-first-run',
            '--no-zygote',
            '--single-process'            // Helps keep memory usage low on mobile
        ]
    });

    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36');
        
        // Timeout set to 20s for mobile data stability
        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 20000 });

        const status = await page.evaluate(() => {
            return {
                google_recaptcha: !!document.querySelector('iframe[src*="google.com/recaptcha"]') || !!document.querySelector('.g-recaptcha'),
                cloudflare_turnstile: !!document.querySelector('iframe[src*="challenges.cloudflare.com"]') || !!document.querySelector('.cf-turnstile'),
                cloudflare_waf: document.title.includes("Just a moment...") || !!document.getElementById('cf-content'),
            };
        });

        await browser.close();
        return status;
    } catch (err) {
        await browser.close();
        return { error: err.message };
    }
}

/**
 * CORE LOGIC 2: ISP Block Check (DNS & SNI)
 */
async function checkISPBlocking(domain) {
    const cleanDomain = domain.replace(/^https?:\/\//, '').split('/')[0];
    let res = { dns_blocked: false, sni_blocked: false };

    // DNS Check
    try {
        const addresses = await dns.resolve4(cleanDomain);
        res.dns_blocked = addresses.some(ip => BLOCK_IPS.includes(ip));
    } catch (e) { res.dns_blocked = true; }

    // SNI Check
    try {
        const response = await axios.get(`https://${cleanDomain}`, { timeout: 5000, validateStatus: false });
        const finalUrl = response.request.res.responseUrl || "";
        if (finalUrl.includes("internetpositif") || finalUrl.includes("uzone.id")) res.sni_blocked = true;
    } catch (e) { res.sni_blocked = true; }

    return res;
}

/**
 * AUTOMATION: The Database Loop
 */
async function runAutoTask() {
    let connection;
    try {
        console.log("📂 Starting Automation: Connecting to DB...");
        connection = await mysql.createConnection(DB_CONFIG);
        const [rows] = await connection.execute('SELECT domain FROM moneysites');
        
        for (let row of rows) {
            const domain = row.domain;
            const targetUrl = domain.startsWith('http') ? domain : `https://${domain}`;
            
            console.log(`🔍 Checking: ${domain}`);
            
            const browserStatus = await getBrowserStatus(targetUrl);
            const ispStatus = await checkISPBlocking(domain);

            const report = {
                domain,
                timestamp: new Date().toISOString(),
                ...browserStatus,
                ...ispStatus,
                status: (ispStatus.dns_blocked || ispStatus.sni_blocked) ? "Blocked" : "Clean"
            };

            await axios.post(WEB_SERVER_RECEIVER, report);
            console.log(`✅ Reported: ${report.status}`);
            
            await new Promise(r => setTimeout(r, 4000)); // 4s cooldown
        }
    } catch (error) {
        console.error("Critical Loop Error:", error.message);
    } finally {
        if (connection) await connection.end();
    }
}

// --- API ROUTES ---

// Manual Check Route
fastify.get('/check', async (request, reply) => {
    const { url } = request.query;
    if (!url) return { error: "Missing URL" };
    
    const bStatus = await getBrowserStatus(url);
    const iStatus = await checkISPBlocking(url);
    return { url, ...bStatus, ...iStatus };
});

// Trigger Automation Route
fastify.get('/run-automation', async (request, reply) => {
    runAutoTask(); // Runs in background
    return { message: "Automation started in background" };
});

// Start Server
fastify.listen({ port: 3000, host: '0.0.0.0' }, (err) => {
    if (err) { console.error(err); process.exit(1); }
    console.log('🚀 Termux Server running on http://localhost:3000');
});

