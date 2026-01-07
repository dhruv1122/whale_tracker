const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
require('dotenv').config();

// Import modules
const blockfrost = require('./src/api/blockfrost');
const coingecko = require('./src/api/coingecko');
const whaleAnalyzer = require('./src/utils/whaleAnalyzer');
const handleResolver = require('./src/api/handleResolver');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// In-memory storage (use database in production)
let appState = {
    whaleData: {
        transactions: [],
        activityScore: 0,
        price: 0.47,
        sentiment: 'Neutral',
        lastUpdate: null
    },
    trackedWallets: new Map(),
    isUpdating: false
};

// Background update interval
let updateInterval = null;

// Serve main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ===== API ENDPOINTS =====

// Get current whale data
app.get('/api/whale-data', (req, res) => {
    res.json(appState.whaleData);
});

// Get current ADA price
app.get('/api/ada-price', async (req, res) => {
    try {
        const price = await coingecko.getADAPrice();
        res.json({ price, timestamp: new Date().toISOString() });
    } catch (error) {
        console.error('Price fetch error:', error.message);
        res.json({ price: appState.whaleData.price, error: 'Using cached price' });
    }
});

// Track a new wallet or handle
app.post('/api/track-wallet', async (req, res) => {
    try {
        const { input, nickname } = req.body;
        
        if (!input || !input.trim()) {
            return res.status(400).json({ error: 'Address or handle is required' });
        }
        
        console.log(`🔍 Processing: ${input}`);
        
        // Resolve address (handle or direct address)
        const resolved = await handleResolver.resolveInput(input.trim());
        
        if (!resolved.success) {
            return res.status(400).json({ error: resolved.error });
        }
        
        const { address } = resolved;
        
        // Check if already tracking
        if (appState.trackedWallets.has(address)) {
            const existing = appState.trackedWallets.get(address);
            return res.status(409).json({ 
                error: `Already tracking this wallet as "${existing.nickname}"`,
                wallet: existing 
            });
        }
        
        // Fetch wallet data
        console.log(`📊 Fetching wallet data...`);
        const walletInfo = await blockfrost.getWalletInfo(address);
        const transactions = await blockfrost.getWalletTransactions(address);
        const analysis = whaleAnalyzer.analyzeWallet(transactions, walletInfo);
        
        // Create wallet entry
        const walletData = {
            id: Date.now().toString(),
            address,
            handle: resolved.handle || null,
            nickname: nickname || resolved.defaultName || `Wallet ${address.slice(0, 8)}`,
            info: walletInfo,
            transactions: transactions.slice(0, 20), // Keep last 20
            analysis,
            source: resolved.source,
            createdAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString()
        };
        
        // Store and broadcast
        appState.trackedWallets.set(address, walletData);
        io.emit('wallet-tracked', walletData);
        
        console.log(`✅ Tracking: ${walletData.nickname}`);
        res.json(walletData);
        
    } catch (error) {
        console.error('Track wallet error:', error);
        res.status(500).json({ 
            error: 'Failed to track wallet',
            details: error.message 
        });
    }
});

// Get tracked wallets list
app.get('/api/tracked-wallets', (req, res) => {
    const wallets = Array.from(appState.trackedWallets.values())
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(wallets);
});

// Get specific wallet data
app.get('/api/wallet/:address', async (req, res) => {
    try {
        const { address } = req.params;
        
        if (!appState.trackedWallets.has(address)) {
            return res.status(404).json({ error: 'Wallet not found' });
        }
        
        const wallet = appState.trackedWallets.get(address);
        
        // Check if data is stale (>5 minutes)
        const lastUpdate = new Date(wallet.lastUpdated);
        const now = new Date();
        const minutesDiff = (now - lastUpdate) / (1000 * 60);
        
        if (minutesDiff > 5) {
            console.log(`🔄 Refreshing ${wallet.nickname}...`);
            
            // Refresh wallet data
            const [info, transactions] = await Promise.all([
                blockfrost.getWalletInfo(address),
                blockfrost.getWalletTransactions(address)
            ]);
            
            wallet.info = info;
            wallet.transactions = transactions.slice(0, 20);
            wallet.analysis = whaleAnalyzer.analyzeWallet(transactions, info);
            wallet.lastUpdated = now.toISOString();
            
            appState.trackedWallets.set(address, wallet);
            io.emit('wallet-updated', wallet);
        }
        
        res.json(wallet);
        
    } catch (error) {
        console.error('Wallet fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch wallet data' });
    }
});

// Get paginated wallet transactions
app.get('/api/wallet/:address/transactions', async (req, res) => {
    try {
        const { address } = req.params;
        const page = parseInt(req.query.page) || 1;
        const count = parseInt(req.query.count) || 20;
        
        // Validate address
        if (!address || typeof address !== 'string') {
            return res.status(400).json({ error: 'Invalid address' });
        }
        
        // Fetch transactions
        const transactions = await blockfrost.getWalletTransactions(address, page, count);
        res.json({ transactions });
    } catch (error) {
        console.error('Paginated wallet transactions error:', error.message);
        res.status(500).json({ error: 'Failed to fetch wallet transactions' });
    }
});

// Remove tracked wallet
app.delete('/api/wallet/:address', (req, res) => {
    const { address } = req.params;
    
    if (appState.trackedWallets.has(address)) {
        const wallet = appState.trackedWallets.get(address);
        appState.trackedWallets.delete(address);
        io.emit('wallet-removed', { address, nickname: wallet.nickname });
        res.json({ success: true, message: `Stopped tracking ${wallet.nickname}` });
    } else {
        res.status(404).json({ error: 'Wallet not found' });
    }
});

// ===== WEBSOCKET EVENTS =====
io.on('connection', (socket) => {
    console.log('🔌 Client connected');
    
    // Send current state
    socket.emit('whale-update', appState.whaleData);
    socket.emit('wallets-update', Array.from(appState.trackedWallets.values()));
    
    socket.on('disconnect', () => {
        console.log('👋 Client disconnected');
    });
    
    socket.on('refresh-data', async () => {
        console.log('🔄 Manual refresh requested');
        await updateWhaleData();
    });
});

// ===== BACKGROUND DATA UPDATES =====
async function updateWhaleData() {
    if (appState.isUpdating) {
        console.log('⏸️ Update already in progress, skipping...');
        return;
    }
    
    appState.isUpdating = true;
    
    try {
        console.log('🔄 Updating whale data...');
        
        // Fetch whale transactions and price in parallel
        const [whaleTransactions, adaPrice] = await Promise.all([
            blockfrost.getWhaleTransactions().catch(err => {
                console.error('Whale transactions error:', err.message);
                return []; // Return empty array on error
            }),
            coingecko.getADAPrice().catch(err => {
                console.error('Price fetch error:', err.message);
                return appState.whaleData.price; // Return cached price
            })
        ]);
        
        // Analyze whale activity
        const analysis = whaleAnalyzer.analyzeWhaleActivity(whaleTransactions);
        
        // Update app state
        appState.whaleData = {
            transactions: whaleTransactions.slice(0, 10),
            activityScore: analysis.score,
            price: adaPrice,
            sentiment: analysis.sentiment,
            totalVolume: analysis.totalVolume,
            lastUpdate: new Date().toISOString()
        };
        
        // Broadcast to all clients
        io.emit('whale-update', appState.whaleData);
        
        console.log(`✅ Updated: ${whaleTransactions.length} transactions, price: $${adaPrice}, sentiment: ${analysis.sentiment}`);
        
    } catch (error) {
        console.error('❌ Update error:', error);
        
        // Broadcast error to clients
        io.emit('update-error', {
            message: 'Failed to update whale data',
            timestamp: new Date().toISOString()
        });
    } finally {
        appState.isUpdating = false;
    }
}

// Start background updates
function startBackgroundUpdates() {
    if (updateInterval) {
        clearInterval(updateInterval);
    }
    
    // Update every 45 seconds
    updateInterval = setInterval(updateWhaleData, 45000);
    
    // Initial data load after 2 seconds
    setTimeout(updateWhaleData, 2000);
}

// ===== SERVER STARTUP =====
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`🌊 Cardano Whale Watcher v2.0 running on http://localhost:${PORT}`);
    console.log(`🔑 Blockfrost API: ${process.env.BLOCKFROST_API_KEY ? 'Configured ✅' : 'Missing ❌'}`);
    
    // Start background updates
    startBackgroundUpdates();
});

// ===== GRACEFUL SHUTDOWN (FIXED) =====
let isShuttingDown = false;

function gracefulShutdown(signal) {
    if (isShuttingDown) {
        console.log('🔄 Shutdown already in progress...');
        return;
    }
    
    isShuttingDown = true;
    console.log(`🛑 Received ${signal}, shutting down gracefully...`);
    
    // Clear background updates
    if (updateInterval) {
        clearInterval(updateInterval);
        console.log('⏹️ Background updates stopped');
    }
    
    // Close server
    server.close((err) => {
        if (err) {
            console.error('❌ Error closing server:', err);
            process.exit(1);
        }
        
        console.log('👋 Server closed successfully');
        process.exit(0);
    });
    
    // Force exit after 5 seconds if graceful shutdown fails
    setTimeout(() => {
        console.log('⚡ Force exiting...');
        process.exit(1);
    }, 5000);
}

// Handle shutdown signals (only once)
process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    console.error('💥 Uncaught Exception:', err);
    gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
    gracefulShutdown('unhandledRejection');
});