// Analyze whale market activity
function analyzeWhaleActivity(transactions) {
    if (!transactions || transactions.length === 0) {
        return {
            score: 0,
            sentiment: 'Neutral',
            totalVolume: 0,
            avgSize: 0,
            largeCount: 0
        };
    }
    
    let totalVolume = 0;
    let largeTransactions = 0;
    let buyPatterns = 0;
    let sellPatterns = 0;
    
    transactions.forEach(tx => {
        totalVolume += tx.amount;
        
        if (tx.amount > 500000) largeTransactions++;
        
        if (tx.type === 'buy') buyPatterns++;
        else if (tx.type === 'sell') sellPatterns++;
    });
    
    const avgSize = totalVolume / transactions.length;
    
    // Calculate activity score
    let score = Math.min((totalVolume / 10000000) * 50, 50); // Volume component
    score += Math.min(transactions.length * 3, 30); // Frequency component  
    score += Math.min(largeTransactions * 5, 20); // Large tx component
    
    // Determine sentiment
    let sentiment = 'Neutral';
    const buyRatio = buyPatterns / (buyPatterns + sellPatterns);
    
    if (buyRatio > 0.7) sentiment = 'Bullish';
    else if (buyRatio < 0.3) sentiment = 'Bearish';
    else if (largeTransactions > 3) sentiment = 'Active';
    
    return {
        score: Math.round(score),
        sentiment,
        totalVolume: Math.round(totalVolume),
        avgSize: Math.round(avgSize),
        largeCount: largeTransactions,
        buyRatio: Math.round(buyRatio * 100)
    };
}

// Analyze individual wallet behavior
function analyzeWallet(transactions, walletInfo) {
    if (!transactions || transactions.length === 0) {
        return {
            totalTransactions: 0,
            totalVolume: 0,
            netFlow: 0,
            tradingPattern: 'Inactive',
            riskLevel: 'Low',
            avgSize: 0
        };
    }
    
    let totalVolume = 0;
    let netFlow = 0;
    let receiveCount = 0;
    let sendCount = 0;
    let largeCount = 0;
    
    transactions.forEach(tx => {
        totalVolume += tx.amount;
        netFlow += tx.netChange;
        
        if (tx.type === 'receive') receiveCount++;
        else sendCount++;
        
        if (tx.amount > 100000) largeCount++;
    });
    
    const avgSize = totalVolume / transactions.length;
    const receiveRatio = receiveCount / transactions.length;
    
    // Determine trading pattern
    let tradingPattern = 'Regular';
    if (avgSize > 1000000) tradingPattern = 'Whale';
    else if (avgSize > 500000) tradingPattern = 'Large Trader';
    else if (receiveRatio > 0.8) tradingPattern = 'Accumulator';
    else if (receiveRatio < 0.2) tradingPattern = 'Distributor';
    
    // Risk assessment
    let riskLevel = 'Low';
    if (largeCount > 10 && avgSize > 1000000) riskLevel = 'Very High';
    else if (largeCount > 5 && avgSize > 500000) riskLevel = 'High';
    else if (avgSize > 100000) riskLevel = 'Medium';
    
    return {
        totalTransactions: transactions.length,
        totalVolume: Math.round(totalVolume),
        netFlow: Math.round(netFlow),
        tradingPattern,
        riskLevel,
        avgSize: Math.round(avgSize),
        receiveRatio: Math.round(receiveRatio * 100),
        largeCount,
        balance: walletInfo.balance
    };
}

// Calculate wallet risk score
function calculateRiskScore(analysis, walletInfo) {
    let score = 0;
    
    // Balance risk
    if (walletInfo.balance > 10000000) score += 30;
    else if (walletInfo.balance > 1000000) score += 20;
    else if (walletInfo.balance > 100000) score += 10;
    
    // Transaction size risk
    if (analysis.avgSize > 1000000) score += 25;
    else if (analysis.avgSize > 500000) score += 15;
    else if (analysis.avgSize > 100000) score += 10;
    
    // Activity frequency risk
    if (analysis.totalTransactions > 50) score += 20;
    else if (analysis.totalTransactions > 20) score += 10;
    
    // Large transaction frequency
    if (analysis.largeCount > 10) score += 25;
    else if (analysis.largeCount > 5) score += 15;
    
    return Math.min(score, 100);
}

module.exports = {
    analyzeWhaleActivity,
    analyzeWallet,
    calculateRiskScore
};