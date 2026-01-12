const mysql = require('mysql2/promise');
const axios = require('axios');

// --- CONFIGURATION ---
const dbConfig = {
    host: '174.138.22.138',     // e.g., 'localhost' or an IP
    user: 'dbUser200mWebsite',
    password: 'ZjdtMhjoj8rczpqEYM8j',
    database: 'db200mWebsite'
};

const CHECKER_API = 'http://localhost:3000/check'; // Your Captcha-Checker API
const WEB_SERVER_URL = 'https://200m.website/api/receiver.php'; // Where to send data
const DELAY_MS = 4000; // 4 seconds delay

// Helper function for delay
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function startAutomation() {
    let connection;

    try {
        console.log("📂 Connecting to MySQL...");
        connection = await mysql.createConnection(dbConfig);

        // 1. Fetch domains from your table
        // Change 'domains_table' and 'domain_column' to your actual names
        const [rows] = await connection.execute('SELECT domain FROM moneysites');
        console.log(`✅ Found ${rows.length} domains to check.`);

        for (let i = 0; i < rows.length; i++) {
            const domain = rows[i].domain;
            console.log(`\n[${i + 1}/${rows.length}] Processing: ${domain}`);

            try {
                // 2. Call the Captcha-Checker API
                // We pass the domain. We ensure it starts with http/https
                const targetUrl = domain.startsWith('http') ? domain : `https://${domain}`;
                const checkResponse = await axios.get(CHECKER_API, {
                    params: { url: targetUrl }
                });

                const resultData = checkResponse.data;
                console.log(`🔍 Check Complete: ${resultData.network_status}`);

                // 3. Send results to your Web Server
                await axios.post(WEB_SERVER_URL, {
                    domain: domain,
                    results: resultData
                });
                console.log(`📤 Results sent to Web Server.`);

            } catch (err) {
                console.error(`❌ Error processing ${domain}:`, err.message);
                // Optional: Send error report to server
                await axios.post(WEB_SERVER_URL, { domain, error: err.message });
            }

            // 4. Wait 4 seconds before the next one
            if (i < rows.length - 1) {
                console.log(`Wait ${DELAY_MS / 1000}s...`);
                await sleep(DELAY_MS);
            }
        }

        // 5. Final Notification
        console.log("\n✨ All domains finished.");
        await axios.post(WEB_SERVER_URL, { 
            note: "Automation task completed successfully",
            total_checked: rows.length,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error("Critical Error:", error);
    } finally {
        if (connection) await connection.end();
    }
}

startAutomation();
