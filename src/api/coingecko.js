const axios = require('axios');

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

const coingecko = axios.create({
    baseURL: COINGECKO_BASE,
    timeout: 8000
});

// Get current ADA price
async function getADAPrice() {
    try {
        const response = await coingecko.get('/simple/price', {
            params: {
                ids: 'cardano',
                vs_currencies: 'usd',
                include_24hr_change: true
            }
        });
        
        const data = response.data.cardano;
        return {
            price: data.usd,
            change24h: data.usd_24h_change,
            timestamp: new Date().toISOString()
        };
        
    } catch (error) {
        console.error('CoinGecko API error:', error.message);
        return 0.47; // Fallback price
    }
}

// Get ADA market data
async function getADAMarketData() {
    try {
        const response = await coingecko.get('/coins/cardano', {
            params: {
                localization: false,
                tickers: false,
                community_data: false,
                developer_data: false
            }
        });
        
        const data = response.data;
        return {
            price: data.market_data.current_price.usd,
            marketCap: data.market_data.market_cap.usd,
            volume24h: data.market_data.total_volume.usd,
            change24h: data.market_data.price_change_percentage_24h,
            rank: data.market_cap_rank
        };
        
    } catch (error) {
        console.error('Market data error:', error.message);
        throw new Error('Failed to fetch market data');
    }
}

module.exports = {
    getADAPrice,
    getADAMarketData
};