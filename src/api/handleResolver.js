const axios = require('axios');

// Multiple handle resolution services for reliability
const HANDLE_SERVICES = [
    {
        name: 'handle.me',
        url: 'https://api.handle.me',
        resolve: async (handle) => {
            const response = await axios.get(`https://api.handle.me/handles/${handle}`, { timeout: 5000 });
            return response.data?.resolved_addresses?.ada;
        }
    },
    {
        name: 'adahandle.com',
        url: 'https://api.adahandle.com',
        resolve: async (handle) => {
            const response = await axios.get(`https://api.adahandle.com/handles/${handle}`, { timeout: 5000 });
            return response.data?.address;
        }
    }
];

// Resolve input (handle or address)
async function resolveInput(input) {
    const trimmed = input.trim();
    
    // Check if it's already a valid address
    if (isValidAddress(trimmed)) {
        return {
            success: true,
            type: 'address',
            address: trimmed,
            handle: null,
            defaultName: `Wallet ${trimmed.slice(0, 8)}`,
            source: 'direct'
        };
    }
    
    // Check if it's a handle
    if (isValidHandle(trimmed)) {
        const cleanHandle = trimmed.replace(/^\$/, '').toLowerCase();
        
        // Try to resolve the handle
        for (const service of HANDLE_SERVICES) {
            try {
                console.log(`🔍 Trying ${service.name} for handle: ${cleanHandle}`);
                const address = await service.resolve(cleanHandle);
                
                if (address && isValidAddress(address)) {
                    return {
                        success: true,
                        type: 'handle',
                        address: address,
                        handle: `$${cleanHandle}`,
                        defaultName: `$${cleanHandle}`,
                        source: service.name
                    };
                }
            } catch (error) {
                console.log(`❌ ${service.name} failed:`, error.message);
                continue;
            }
        }
        
        return {
            success: false,
            error: `Handle "${trimmed}" not found or unable to resolve`
        };
    }
    
    return {
        success: false,
        error: 'Invalid format. Use Cardano address (addr1...) or handle ($alice)'
    };
}

// Validate Cardano address
function isValidAddress(input) {
    return (
        typeof input === 'string' &&
        input.startsWith('addr1') &&
        input.length >= 50 &&
        input.length <= 120 &&
        /^addr1[a-z0-9]+$/.test(input)
    );
}

// Validate handle format
function isValidHandle(input) {
    if (!input || typeof input !== 'string') return false;
    
    const withoutDollar = input.replace(/^\$/, '');
    
    return (
        withoutDollar.length >= 1 &&
        withoutDollar.length <= 15 &&
        /^[a-zA-Z0-9_-]+$/.test(withoutDollar) &&
        !input.startsWith('addr1')
    );
}

// Get known popular handles
function getPopularHandles() {
    return [
        { input: '$charles', nickname: 'Charles Hoskinson' },
        { input: '$iohk', nickname: 'IOHK Official' },
        { input: '$emurgo', nickname: 'Emurgo' },
        { input: '$minswap', nickname: 'MinSwap DEX' }
    ];
}

module.exports = {
    resolveInput,
    isValidAddress,
    isValidHandle,
    getPopularHandles
};