// Initialize WebSocket connection
const socket = io();

// DOM Elements
const statusIndicator = document.getElementById('status-indicator');
const activityScore = document.getElementById('activity-score');
const adaPrice = document.getElementById('ada-price');
const sentiment = document.getElementById('sentiment');
const transactionCount = document.getElementById('transaction-count');
const lastUpdateTime = document.getElementById('last-update-time');

const walletInput = document.getElementById('wallet-input');
const nicknameInput = document.getElementById('nickname-input');
const trackBtn = document.getElementById('track-btn');
const trackedWallets = document.getElementById('tracked-wallets');
const walletList = document.getElementById('wallet-list');
const walletCount = document.getElementById('wallet-count');
const whaleList = document.getElementById('whale-list');

// App State
let isConnected = false;
let trackedWalletsMap = new Map();

// ===== SOCKET EVENTS =====
socket.on('connect', () => {
    console.log('🟢 Connected to server');
    isConnected = true;
    updateStatus('🟢 Connected', 'connected');
});

socket.on('disconnect', () => {
    console.log('🔴 Disconnected from server');
    isConnected = false;
    updateStatus('🔴 Disconnected', 'disconnected');
});

socket.on('whale-update', (data) => {
    console.log('📊 Whale data update received');
    updateWhaleData(data);
});

socket.on('wallet-tracked', (wallet) => {
    console.log('🎯 New wallet tracked:', wallet.nickname);
    trackedWalletsMap.set(wallet.address, wallet);
    renderTrackedWallets();
    showNotification(`✅ Now tracking ${wallet.nickname}`, 'success');
});

socket.on('wallet-updated', (wallet) => {
    console.log('🔄 Wallet updated:', wallet.nickname);
    trackedWalletsMap.set(wallet.address, wallet);
    renderTrackedWallets();
});

socket.on('wallet-removed', (data) => {
    console.log('🗑️ Wallet removed:', data.nickname);
    trackedWalletsMap.delete(data.address);
    renderTrackedWallets();
    showNotification(`🗑️ Stopped tracking ${data.nickname}`, 'info');
});

socket.on('update-error', (error) => {
    console.error('❌ Update error:', error);
    showNotification('⚠️ Update failed - retrying...', 'warning');
});

// ===== UI FUNCTIONS =====
function updateStatus(text, type) {
    statusIndicator.textContent = text;
    statusIndicator.className = `status-indicator ${type}`;
}

function updateWhaleData(data) {
    // Update stats
    if (activityScore) activityScore.textContent = data.activityScore || '0';
    if (adaPrice) adaPrice.textContent = `$${(data.price || 0.47).toFixed(3)}`;
    if (sentiment) sentiment.textContent = data.sentiment || 'Neutral';
    if (transactionCount) transactionCount.textContent = data.transactions?.length || '0';
    if (lastUpdateTime) lastUpdateTime.textContent = new Date().toLocaleTimeString();
    
    // Update whale transactions
    renderWhaleTransactions(data.transactions || []);
}

function renderWhaleTransactions(transactions) {
    if (!whaleList) return;
    
    if (transactions.length === 0) {
        whaleList.innerHTML = '<div class="loading">🔍 No whale activity detected recently</div>';
        return;
    }
    
    whaleList.innerHTML = transactions.map(tx => `
        <div class="activity-item ${tx.type}">
            <div class="activity-header">
                <span class="activity-hash" onclick="copyToClipboard('${tx.hash}')" title="Click to copy">
                    ${tx.hash.slice(0, 16)}...
                </span>
                <span class="activity-amount ${tx.type === 'buy' ? 'positive' : 'negative'}">
                    ${tx.amountFormatted}
                </span>
            </div>
            <div class="activity-details">
                ${tx.usd} • ${getTimeAgo(new Date(tx.timestamp))} • ${tx.confidence}
                ${tx.type === 'buy' ? '🟢' : '🔴'} ${tx.type.toUpperCase()}
            </div>
        </div>
    `).join('');
}

function renderTrackedWallets() {
    const wallets = Array.from(trackedWalletsMap.values());
    
    if (wallets.length === 0) {
        trackedWallets.style.display = 'none';
        return;
    }
    
    trackedWallets.style.display = 'block';
    walletCount.textContent = wallets.length;
    
    walletList.innerHTML = wallets.map(wallet => `
        <div class="wallet-card" id="wallet-card-${wallet.address}">
            <div class="wallet-header">
                <div class="wallet-info">
                    <div class="wallet-name">${wallet.nickname}</div>
                    <div class="wallet-address" onclick="copyToClipboard('${wallet.address}')">
                        ${wallet.handle || wallet.address.slice(0, 16) + '...'}
                    </div>
                </div>
                <div class="wallet-actions">
                    <button class="action-btn" onclick="refreshWallet('${wallet.address}')">🔄</button>
                    <button class="action-btn" onclick="removeWallet('${wallet.address}')">❌</button>
                </div>
            </div>
            <div class="wallet-stats">
                <div class="wallet-stat">
                    <span class="stat-label">Balance</span>
                    <div class="stat-value">${wallet.info?.balanceFormatted || '0 ADA'}</div>
                </div>
                <div class="wallet-stat">
                    <span class="stat-label">Transactions</span>
                    <div class="stat-value">${wallet.analysis?.totalTransactions || 0}</div>
                </div>
                <div class="wallet-stat">
                    <span class="stat-label">Pattern</span>
                    <div class="stat-value">${wallet.analysis?.tradingPattern || 'Unknown'}</div>
                </div>
                <div class="wallet-stat">
                    <span class="stat-label">Risk</span>
                    <div class="stat-value">${wallet.analysis?.riskLevel || 'Low'}</div>
                </div>
            </div>
            <button class="btn view-tx-btn" data-address="${wallet.address}">View Transactions</button>
            <div class="wallet-transactions" id="wallet-tx-${wallet.address}" style="display:none;"></div>
        </div>
    `).join('');

    // Attach event listeners for 'View Transactions' buttons
    document.querySelectorAll('.view-tx-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const address = btn.getAttribute('data-address');
            const txSection = document.getElementById(`wallet-tx-${address}`);
            if (txSection.style.display === 'none') {
                txSection.style.display = 'block';
                if (!txSection.hasChildNodes()) {
                    await loadWalletTransactions(address, 1, txSection);
                }
            } else {
                txSection.style.display = 'none';
            }
        });
    });
}

async function loadWalletTransactions(address, page = 1, container = null) {
    if (!container) container = document.getElementById(`wallet-tx-${address}`);
    if (!container) return;
    container.innerHTML = '<div class="loading">Loading transactions...</div>';
    try {
        const response = await fetch(`/api/wallet/${address}/transactions?page=${page}&count=10`);
        const data = await response.json();
        if (response.ok && data.transactions) {
            renderWalletTransactions(address, data.transactions, page, container);
        } else {
            container.innerHTML = '<div class="loading">No transactions found.</div>';
        }
    } catch (err) {
        container.innerHTML = '<div class="loading">Failed to load transactions.</div>';
    }
}

function renderWalletTransactions(address, transactions, page, container) {
    if (!transactions || transactions.length === 0) {
        container.innerHTML = '<div class="loading">No transactions found.</div>';
        return;
    }
    const txHtml = transactions.map(tx => `
        <div class="activity-item ${tx.type}">
            <div class="activity-header">
                <span class="activity-hash" onclick="copyToClipboard('${tx.hash}')" title="Click to copy">
                    ${tx.hash.slice(0, 16)}...
                </span>
                <span class="activity-amount ${tx.type === 'receive' ? 'positive' : 'negative'}">
                    ${tx.amountFormatted}
                </span>
            </div>
            <div class="activity-details">
                ${tx.usd} • ${getTimeAgo(new Date(tx.timestamp))} • ${tx.type === 'receive' ? '🟢 RECEIVE' : '🔴 SEND'}
            </div>
        </div>
    `).join('');
    // Add Load More button
    container.innerHTML = txHtml + `<button class="btn load-more-btn" data-address="${address}" data-page="${page + 1}">Load More</button>`;
    // Attach event listener for Load More
    container.querySelector('.load-more-btn').addEventListener('click', function() {
        loadMoreWalletTransactions(address, page + 1, container);
    });
}

async function loadMoreWalletTransactions(address, page, container) {
    const btn = container.querySelector('.load-more-btn');
    if (btn) btn.disabled = true;
    try {
        const response = await fetch(`/api/wallet/${address}/transactions?page=${page}&count=10`);
        const data = await response.json();
        if (response.ok && data.transactions && data.transactions.length > 0) {
            // Remove old Load More button
            btn.remove();
            // Append new transactions
            const txHtml = data.transactions.map(tx => `
                <div class="activity-item ${tx.type}">
                    <div class="activity-header">
                        <span class="activity-hash" onclick="copyToClipboard('${tx.hash}')" title="Click to copy">
                            ${tx.hash.slice(0, 16)}...
                        </span>
                        <span class="activity-amount ${tx.type === 'receive' ? 'positive' : 'negative'}">
                            ${tx.amountFormatted}
                        </span>
                    </div>
                    <div class="activity-details">
                        ${tx.usd} • ${getTimeAgo(new Date(tx.timestamp))} • ${tx.type === 'receive' ? '🟢 RECEIVE' : '🔴 SEND'}
                    </div>
                </div>
            `).join('');
            container.innerHTML += txHtml;
            // Add new Load More button
            const newBtn = document.createElement('button');
            newBtn.className = 'btn load-more-btn';
            newBtn.textContent = 'Load More';
            newBtn.setAttribute('data-address', address);
            newBtn.setAttribute('data-page', page + 1);
            newBtn.addEventListener('click', function() {
                loadMoreWalletTransactions(address, page + 1, container);
            });
            container.appendChild(newBtn);
        } else {
            btn.textContent = 'No more transactions';
            btn.disabled = true;
        }
    } catch (err) {
        if (btn) btn.textContent = 'Failed to load more';
    }
}

// ===== WALLET TRACKING =====
async function trackWallet() {
    const input = walletInput.value.trim();
    const nickname = nicknameInput.value.trim();
    
    if (!input) {
        showNotification('❌ Please enter a wallet address or handle', 'error');
        return;
    }
    
    // Show loading
    trackBtn.disabled = true;
    trackBtn.textContent = '🔄 Tracking...';
    
    try {
        const response = await fetch('/api/track-wallet', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ input, nickname })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            // Clear inputs
            walletInput.value = '';
            nicknameInput.value = '';
            
            // Success message handled by socket event
        } else {
            showNotification(`❌ ${data.error}`, 'error');
        }
    } catch (error) {
        console.error('Track error:', error);
        showNotification('❌ Failed to track wallet', 'error');
    } finally {
        trackBtn.disabled = false;
        trackBtn.textContent = '🔍 Track';
    }
}

async function refreshWallet(address) {
    try {
        const response = await fetch(`/api/wallet/${address}`);
        if (response.ok) {
            showNotification('🔄 Wallet refreshed', 'success');
        }
    } catch (error) {
        showNotification('❌ Refresh failed', 'error');
    }
}

async function removeWallet(address) {
    if (!confirm('Remove this wallet from tracking?')) return;
    
    try {
        const response = await fetch(`/api/wallet/${address}`, { method: 'DELETE' });
        if (response.ok) {
            // Success handled by socket event
        }
    } catch (error) {
        showNotification('❌ Failed to remove wallet', 'error');
    }
}

// ===== UTILITY FUNCTIONS =====
function getTimeAgo(date) {
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);
    
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showNotification('📋 Copied to clipboard', 'info');
    }).catch(() => {
        showNotification('❌ Copy failed', 'error');
    });
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        padding: 12px 16px;
        border-radius: 8px;
        font-weight: 600;
        z-index: 1001;
        backdrop-filter: blur(10px);
        animation: slideIn 0.3s ease;
        max-width: 300px;
    `;
    
    const colors = {
        success: 'background: rgba(74, 222, 128, 0.9); color: white;',
        error: 'background: rgba(248, 113, 113, 0.9); color: white;',
        warning: 'background: rgba(251, 191, 36, 0.9); color: white;',
        info: 'background: rgba(59, 130, 246, 0.9); color: white;'
    };
    
    notification.style.cssText += colors[type] || colors.info;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 4000);
}

// ===== EVENT LISTENERS =====
trackBtn.addEventListener('click', trackWallet);

walletInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') trackWallet();
});

nicknameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') trackWallet();
});

// Quick add buttons
document.querySelectorAll('.quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        walletInput.value = btn.dataset.input;
        nicknameInput.value = btn.dataset.nickname;
        trackWallet();
    });
});

// Load initial data
window.addEventListener('load', () => {
    console.log('🚀 Whale Watcher v2.0 initialized');
    
    // Load tracked wallets
    fetch('/api/tracked-wallets')
        .then(r => r.json())
        .then(wallets => {
            wallets.forEach(wallet => {
                trackedWalletsMap.set(wallet.address, wallet);
            });
            renderTrackedWallets();
        })
        .catch(console.error);
});

// Add CSS animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
`;
document.head.appendChild(style);