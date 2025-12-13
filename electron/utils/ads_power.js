class AdsPower {
    constructor(baseUrl, apiKey) {
        this.baseUrl = baseUrl;
        this.apiKey = apiKey;
    }

    async start(profileId) {
        const response = await fetch(`${this.baseUrl}/api/v2/browser-profile/start`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
                "profile_id": profileId,
            }),
        });
        const result = await response.json();
        if (result.code !== 0) {
            throw new Error(result.message);
        }
        return result.data.ws.puppeteer;
    }

    async stop(profileId) {
        const response = await fetch(`${this.baseUrl}/api/v2/browser-profile/stop`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
                "profile_id": profileId,
            }),
        });
        const result = await response.json();
        if (result.code !== 0) {
            throw new Error(result.message);
        }
        return true;
    }
}

module.exports = AdsPower;