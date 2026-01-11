const mysql = require('mysql2/promise');
const axios = require('axios');

// --- Configuration ---
const DB_CONFIG = { host: '174.138.22.138', user: 'dbUser200mWebsite', password: 'ZjdtMhjoj8rczpqEYM8j', database: 'db200mWebsite' };
const LOCAL_POST_URL = 'http://localhost:8000/api/check';
const LOCAL_GET_URL = 'http://localhost:3000/check';
const REMOTE_SERVER = 'https://200m.website/api/receiver.php';

// Helper function for the 3-4 second delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function startSync() {
    let connection;
    try {
        connection = await mysql.createConnection(DB_CONFIG);
        console.log("Connected to local database.");

        // 1. Fetch all domains into an array
        const [rows] = await connection.execute('SELECT domain FROM moneysites');
        const domains = rows.map(r => r.domain_url);
        
        console.log(`Found ${domains.length} domains. Starting processing...`);

        const syncResults = [];

        // 2. Loop through domains with delay
        for (const domain of domains) {
            console.log(`Processing: ${domain}`);

            try {
                // A. Call Port 8000 (POST)
                const res8000 = await axios.post(LOCAL_POST_URL, { domains: [domain] });

                // B. Call Port 3000 (GET) - appending domain with https as requested
                const res3000 = await axios.get(`${LOCAL_GET_URL}?url=https://${domain}`);

                // C. Prepare result for this specific domain
                const domainResult = {
                    domain: domain,
                    status8000: res8000.data,
                    status3000: res3000.data,
                    timestamp: new Date().toISOString()
                };

                syncResults.push(domainResult);

            } catch (err) {
                console.error(`Error checking ${domain}:`, err.message);
            }

            // 3. Wait for 4 seconds before next domain
            await delay(4000); 
        }

        // 4. Once array is finished, send final POST to web server
        console.log("All domains processed. Sending report to remote server...");
        await axios.post(REMOTE_SERVER, {
            summary: "Sync Completed",
            data: syncResults
        });

        console.log("Sync process finished successfully.");

    } catch (error) {
        console.error("Critical Sync Error:", error);
    } finally {
        if (connection) await connection.end();
    }
}

// Execute
startSync();