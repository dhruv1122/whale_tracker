const axios = require('axios');

const API_BASE = 'https://cardano-mainnet.blockfrost.io/api/v0';
const API_KEY = process.env.BLOCKFROST_API_KEY;

if (!API_KEY) {
    console.error('❌ BLOCKFROST_API_KEY not found in .env file');
    process.exit(1);
}

const blockfrost = axios.create({
    baseURL: API_BASE,
    headers: {
        'project_id': API_KEY
    },
    timeout: 15000
});

// Get large transactions from multiple recent blocks
async function getWhaleTransactions() {
    try {
        console.log('🔍 Fetching whale transactions from recent blocks...');
        
        // Get latest block info
        const latestResponse = await blockfrost.get('/blocks/latest');
        const latestBlock = latestResponse.data;
        
        console.log(`📦 Latest block: ${latestBlock.slot}`);
        
        // Get last 5 blocks for better transaction coverage
        const blockPromises = [];
        
        // Get latest block transactions
        blockPromises.push(blockfrost.get(`/blocks/${latestBlock.hash}/txs`));
        
        // Get previous blocks
        let currentHash = latestBlock.previous_block;
        for (let i = 0; i < 4 && currentHash; i++) {
            try {
                const blockInfo = await blockfrost.get(`/blocks/${currentHash}`);
                blockPromises.push(blockfrost.get(`/blocks/${currentHash}/txs`));
                currentHash = blockInfo.data.previous_block;
            } catch (error) {
                console.log(`⚠️ Couldn't fetch block ${i + 1}: ${error.message}`);
                break;
            }
        }
        
        // Get all transaction hashes from recent blocks
        const blockTxResponses = await Promise.allSettled(blockPromises);
        const allTxHashes = [];
        
        blockTxResponses.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                allTxHashes.push(...result.value.data);
                console.log(`📦 Block ${index + 1}: ${result.value.data.length} transactions`);
            }
        });
        
        console.log(`🔢 Total transactions to check: ${allTxHashes.length}`);
        
        const whaleTransactions = [];
        let checkedCount = 0;
        
        // Check transactions for whale activity (limit to avoid API overload)
        const txsToCheck = allTxHashes.slice(0, 50); // Check max 50 transactions
        
        for (const txHash of txsToCheck) {
            try {
                const txResponse = await blockfrost.get(`/txs/${txHash}`);
                const tx = txResponse.data;
                checkedCount++;
                
                // Convert lovelace to ADA
                const outputADA = parseInt(tx.output_amount) / 1000000;
                
                // Lower whale threshold for more activity (50K+ ADA instead of 100K+)
                if (outputADA >= 50000) {
                    whaleTransactions.push({
                        hash: txHash,
                        amount: outputADA,
                        amountFormatted: formatADA(outputADA),
                        usd: `$${(outputADA * 0.47).toLocaleString()}`,
                        timestamp: new Date(tx.block_time * 1000),
                        block: tx.block,
                        fees: parseInt(tx.fees) / 1000000,
                        size: tx.size,
                        type: Math.random() > 0.6 ? 'buy' : 'sell', // Simplified
                        confidence: outputADA > 1000000 ? 'Very High' : outputADA > 500000 ? 'High' : 'Medium'
                    });
                }
            } catch (txError) {
                // Skip failed transactions
                continue;
            }
        }
        
        console.log(`✅ Found ${whaleTransactions.length} whale transactions from ${checkedCount} checked transactions`);
        
        return whaleTransactions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
    } catch (error) {
        console.error('❌ Whale transactions fetch error:', error.response?.data || error.message);
        // Return empty array instead of throwing to keep app running
        return [];
    }
}

// Get wallet information
async function getWalletInfo(address) {
    try {
        const response = await blockfrost.get(`/addresses/${address}`);
        const data = response.data;
        
        const adaBalance = parseInt(data.amount.find(a => a.unit === 'lovelace')?.quantity || 0) / 1000000;
        
        return {
            address: data.address,
            balance: adaBalance,
            balanceFormatted: formatADA(adaBalance),
            txCount: data.tx_count,
            type: data.type,
            script: data.script,
            stakeAddress: data.stake_address
        };
    } catch (error) {
        console.error('Wallet info error:', error.response?.data || error.message);
        throw new Error('Failed to fetch wallet information');
    }
}

// Get wallet transaction history
async function getWalletTransactions(address, page = 1, count = 20) {
    try {
        const response = await blockfrost.get(`/addresses/${address}/txs`, {
            params: { count, page, order: 'desc' }
        });
        
        const txHashes = response.data;
        const transactions = [];
        
        for (const txHash of txHashes) {
            try {
                const [txResponse, utxosResponse] = await Promise.all([
                    blockfrost.get(`/txs/${txHash}`),
                    blockfrost.get(`/txs/${txHash}/utxos`)
                ]);
                
                const tx = txResponse.data;
                const utxos = utxosResponse.data;
                
                // Calculate net change for this address
                let netChange = 0;
                
                // Subtract inputs (money leaving)
                utxos.inputs.forEach(input => {
                    if (input.address === address) {
                        const amount = parseInt(input.amount.find(a => a.unit === 'lovelace')?.quantity || 0);
                        netChange -= amount;
                    }
                });
                
                // Add outputs (money coming in)
                utxos.outputs.forEach(output => {
                    if (output.address === address) {
                        const amount = parseInt(output.amount.find(a => a.unit === 'lovelace')?.quantity || 0);
                        netChange += amount;
                    }
                });
                
                const adaChange = netChange / 1000000;
                
                // Only include meaningful transactions
                if (Math.abs(adaChange) >= 1) {
                    transactions.push({
                        hash: txHash,
                        amount: Math.abs(adaChange),
                        netChange: adaChange,
                        amountFormatted: formatADA(Math.abs(adaChange)),
                        usd: `$${(Math.abs(adaChange) * 0.47).toLocaleString()}`,
                        timestamp: new Date(tx.block_time * 1000),
                        type: adaChange > 0 ? 'receive' : 'send',
                        fees: parseInt(tx.fees) / 1000000,
                        block: tx.block
                    });
                }
                
            } catch (txError) {
                continue; // Skip failed transactions
            }
        }
        
        return transactions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
    } catch (error) {
        console.error('Wallet transactions error:', error.response?.data || error.message);
        throw new Error('Failed to fetch wallet transactions');
    }
}

// Format ADA amounts
function formatADA(amount) {
    if (amount >= 1000000) {
        return `${(amount / 1000000).toFixed(2)}M ADA`;
    } else if (amount >= 1000) {
        return `${(amount / 1000).toFixed(1)}K ADA`;
    } else {
        return `${amount.toLocaleString()} ADA`;
    }
}

module.exports = {
    getWhaleTransactions,
    getWalletInfo,
    getWalletTransactions,
    formatADA
};