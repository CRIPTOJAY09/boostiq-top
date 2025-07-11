const express = require('express');
const axios = require('axios');
const cors = require('cors');
const NodeCache = require('node-cache');

// 🎯 CONFIGURACIÓN PARA RAILWAY
const app = express();
const cache = new NodeCache({ 
    stdTTL: 30, // Cache por 30 segundos
    checkperiod: 60, // Verificar cada minuto
    useClones: false, // Mejor rendimiento
    maxKeys: 100 // Límite de keys en cache
});

app.use(cors());
app.use(express.json());

// 🚨 MANEJO GLOBAL DE ERRORES
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    // No salir del proceso en producción
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // No salir del proceso en producción
});

// Middleware de manejo de errores
app.use((err, req, res, next) => {
    console.error('Error middleware:', err);
    res.status(500).json({ 
        error: 'Error interno del servidor',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Error interno'
    });
});

// 🔥 CONFIGURACIÓN DEL SISTEMA
const CONFIG = {
    BINANCE_API_KEY: process.env.BINANCE_API_KEY || 'Sr3uBcWgM8ZZS2Uu3liN1nEodwiwN4RVfAbjmpKYnUs9VE6sl8eeHoh4ZNYNpvs2',
    BINANCE_SECRET: process.env.BINANCE_SECRET || '', // No necesario para endpoints públicos
    BINANCE_BASE_URL: 'https://api.binance.com',
    EXPLOSION_MIN_VOLUME: 1000000, // Volumen mínimo en USDT
    EXPLOSION_MIN_GAIN: 8, // Ganancia mínima 8%
    MIN_PRICE: 0.000001, // Precio mínimo para evitar shitcoins
    MAX_PRICE: 100, // Precio máximo para tokens accesibles
    VOLUME_SPIKE_THRESHOLD: 3, // 3x el volumen normal
    RSI_OVERSOLD: 30,
    RSI_OVERBOUGHT: 70
};

// 🧮 CALCULADORA DE INDICADORES TÉCNICOS MEJORADA
class TechnicalAnalysis {
    static calculateRSI(prices, period = 14) {
        if (prices.length < period) return 50;
        
        let gains = 0;
        let losses = 0;
        
        for (let i = 1; i < period + 1; i++) {
            const change = prices[i] - prices[i - 1];
            if (change > 0) gains += change;
            else losses -= change;
        }
        
        const avgGain = gains / period;
        const avgLoss = losses / period;
        
        if (avgLoss === 0) return 100;
        
        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    }
    
    static calculateVolatility(prices) {
        if (prices.length < 2) return 0;
        
        const returns = [];
        for (let i = 1; i < prices.length; i++) {
            returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
        }
        
        const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
        
        return Math.sqrt(variance) * 100;
    }
    
    static detectVolumeSpike(currentVolume, avgVolume) {
        if (!avgVolume || avgVolume === 0) return 1;
        return currentVolume / avgVolume;
    }

    // 🔥 NUEVO: Análisis técnico con datos históricos
    static async analyzeTechnicals(symbol) {
        try {
            const historicalData = await getHistoricalData(symbol);
            if (historicalData.length === 0) return null;

            const prices = historicalData.map(candle => candle.close);
            const volumes = historicalData.map(candle => candle.volume);
            
            const rsi = this.calculateRSI(prices);
            const volatility = this.calculateVolatility(prices);
            const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
            const currentVolume = volumes[volumes.length - 1];
            const volumeSpike = this.detectVolumeSpike(currentVolume, avgVolume);

            return {
                rsi: rsi.toFixed(2),
                volatility: volatility.toFixed(2),
                volumeSpike: volumeSpike.toFixed(2),
                trend: this.getTrend(prices),
                support: Math.min(...prices.slice(-5)).toFixed(8),
                resistance: Math.max(...prices.slice(-5)).toFixed(8)
            };
        } catch (error) {
            console.error(`Error en análisis técnico para ${symbol}:`, error.message);
            return null;
        }
    }

    static getTrend(prices) {
        const recent = prices.slice(-5);
        const older = prices.slice(-10, -5);
        
        const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
        const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
        
        if (recentAvg > olderAvg * 1.02) return 'BULLISH';
        if (recentAvg < olderAvg * 0.98) return 'BEARISH';
        return 'NEUTRAL';
    }
}

// 🎯 SISTEMA DE SCORING INTELIGENTE
class ExplosionDetector {
    static calculateExplosionScore(token) {
        let score = 0;
        const analysis = {};
        
        // 1. Análisis de precio y ganancia (30 puntos)
        const priceChange = parseFloat(token.priceChangePercent);
        if (priceChange > 20) score += 30;
        else if (priceChange > 15) score += 25;
        else if (priceChange > 10) score += 20;
        else if (priceChange > 5) score += 15;
        else if (priceChange > 0) score += 10;
        
        analysis.priceScore = Math.min(30, Math.max(0, score));
        
        // 2. Análisis de volumen (25 puntos)
        const volume = parseFloat(token.quoteVolume);
        let volumeScore = 0;
        if (volume > 50000000) volumeScore = 25;
        else if (volume > 20000000) volumeScore = 20;
        else if (volume > 10000000) volumeScore = 15;
        else if (volume > 5000000) volumeScore = 10;
        else if (volume > 1000000) volumeScore = 5;
        
        score += volumeScore;
        analysis.volumeScore = volumeScore;
        
        // 3. Análisis de momentum (20 puntos)
        const price = parseFloat(token.lastPrice);
        const momentum = priceChange > 0 ? Math.min(20, priceChange) : 0;
        score += momentum;
        analysis.momentumScore = momentum;
        
        // 4. Análisis de accesibilidad de precio (15 puntos)
        let priceAccessibility = 0;
        if (price > 0.001 && price < 10) priceAccessibility = 15;
        else if (price > 0.0001 && price < 50) priceAccessibility = 10;
        else if (price > 0.00001 && price < 100) priceAccessibility = 5;
        
        score += priceAccessibility;
        analysis.priceAccessibility = priceAccessibility;
        
        // 5. Bonus por volatilidad controlada (10 puntos)
        const volatilityBonus = priceChange > 0 && priceChange < 100 ? 10 : 0;
        score += volatilityBonus;
        analysis.volatilityBonus = volatilityBonus;
        
        return {
            totalScore: Math.min(100, score),
            breakdown: analysis,
            recommendation: this.getRecommendation(score, token)
        };
    }
    
    static getRecommendation(score, token) {
        const price = parseFloat(token.lastPrice);
        const change = parseFloat(token.priceChangePercent);
        
        if (score >= 80) {
            return {
                action: "🔥 COMPRA FUERTE",
                confidence: "MUY ALTA",
                buyPrice: price,
                sellTarget: (price * 1.25).toFixed(8),
                stopLoss: (price * 0.85).toFixed(8),
                risk: "ALTO",
                timeframe: "1-6 horas"
            };
        } else if (score >= 60) {
            return {
                action: "📈 COMPRA MODERADA",
                confidence: "ALTA",
                buyPrice: price,
                sellTarget: (price * 1.15).toFixed(8),
                stopLoss: (price * 0.90).toFixed(8),
                risk: "MEDIO",
                timeframe: "6-24 horas"
            };
        } else if (score >= 40) {
            return {
                action: "⚠️ OBSERVAR",
                confidence: "MEDIA",
                buyPrice: price,
                sellTarget: (price * 1.10).toFixed(8),
                stopLoss: (price * 0.95).toFixed(8),
                risk: "MEDIO",
                timeframe: "1-3 días"
            };
        } else {
            return {
                action: "❌ EVITAR",
                confidence: "BAJA",
                buyPrice: null,
                sellTarget: null,
                stopLoss: null,
                risk: "ALTO",
                timeframe: "No recomendado"
            };
        }
    }
}

// 🌐 OBTENER DATOS DE BINANCE CON API KEY
async function getBinanceData() {
    try {
        const headers = {
            'X-MBX-APIKEY': CONFIG.BINANCE_API_KEY,
            'User-Agent': 'Mozilla/5.0 (compatible; BoostIQ/1.0)'
        };

        // Obtener datos de 24hr con API key para mayor límite
        const response = await axios.get(`${CONFIG.BINANCE_BASE_URL}/api/v3/ticker/24hr`, {
            headers,
            timeout: 10000
        });

        return response.data.filter(token => 
            token.symbol.endsWith('USDT') && 
            parseFloat(token.quoteVolume) > CONFIG.EXPLOSION_MIN_VOLUME &&
            parseFloat(token.lastPrice) > CONFIG.MIN_PRICE &&
            parseFloat(token.lastPrice) < CONFIG.MAX_PRICE
        );
    } catch (error) {
        console.error('Error obteniendo datos de Binance:', error.message);
        
        // Fallback sin API key si falla
        try {
            const fallbackResponse = await axios.get('https://api.binance.com/api/v3/ticker/24hr', {
                timeout: 5000
            });
            return fallbackResponse.data.filter(token => 
                token.symbol.endsWith('USDT') && 
                parseFloat(token.quoteVolume) > CONFIG.EXPLOSION_MIN_VOLUME
            );
        } catch (fallbackError) {
            console.error('Fallback también falló:', fallbackError.message);
            return [];
        }
    }
}

// 🔥 OBTENER DATOS HISTÓRICOS CON API KEY
async function getHistoricalData(symbol, interval = '1h', limit = 24) {
    try {
        const headers = {
            'X-MBX-APIKEY': CONFIG.BINANCE_API_KEY
        };

        const response = await axios.get(`${CONFIG.BINANCE_BASE_URL}/api/v3/klines`, {
            headers,
            params: {
                symbol,
                interval,
                limit
            },
            timeout: 5000
        });

        return response.data.map(candle => ({
            timestamp: candle[0],
            open: parseFloat(candle[1]),
            high: parseFloat(candle[2]),
            low: parseFloat(candle[3]),
            close: parseFloat(candle[4]),
            volume: parseFloat(candle[5])
        }));
    } catch (error) {
        console.error(`Error obteniendo datos históricos para ${symbol}:`, error.message);
        return [];
    }
}

// 🔥 ENDPOINT: EXPLOSION CANDIDATES
app.get('/api/explosion-candidates', async (req, res) => {
    try {
        const cacheKey = 'explosion-candidates';
        let cachedData = cache.get(cacheKey);
        
        if (cachedData) {
            return res.json(cachedData);
        }
        
        const binanceData = await getBinanceData();
        
        const explosionCandidates = binanceData
            .filter(token => parseFloat(token.priceChangePercent) > CONFIG.EXPLOSION_MIN_GAIN)
            .map(token => {
                const analysis = ExplosionDetector.calculateExplosionScore(token);
                return {
                    symbol: token.symbol,
                    price: parseFloat(token.lastPrice),
                    priceChangePercent: parseFloat(token.priceChangePercent),
                    volume: parseFloat(token.quoteVolume),
                    explosionScore: analysis.totalScore,
                    analysis: analysis.breakdown,
                    recommendation: analysis.recommendation,
                    timestamp: new Date().toISOString()
                };
            })
            .sort((a, b) => b.explosionScore - a.explosionScore)
            .slice(0, 5);
        
        cache.set(cacheKey, explosionCandidates);
        res.json(explosionCandidates);
        
    } catch (error) {
        console.error('Error en explosion-candidates:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// 📈 ENDPOINT: TOP GAINERS
app.get('/api/top-gainers', async (req, res) => {
    try {
        const cacheKey = 'top-gainers';
        let cachedData = cache.get(cacheKey);
        
        if (cachedData) {
            return res.json(cachedData);
        }
        
        const binanceData = await getBinanceData();
        
        const topGainers = binanceData
            .filter(token => parseFloat(token.priceChangePercent) > 0)
            .map(token => {
                const analysis = ExplosionDetector.calculateExplosionScore(token);
                return {
                    symbol: token.symbol,
                    price: parseFloat(token.lastPrice),
                    priceChangePercent: parseFloat(token.priceChangePercent),
                    volume: parseFloat(token.quoteVolume),
                    score: analysis.totalScore,
                    recommendation: analysis.recommendation,
                    timestamp: new Date().toISOString()
                };
            })
            .sort((a, b) => b.priceChangePercent - a.priceChangePercent)
            .slice(0, 5);
        
        cache.set(cacheKey, topGainers);
        res.json(topGainers);
        
    } catch (error) {
        console.error('Error en top-gainers:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// 🆕 ENDPOINT: NEW LISTINGS
app.get('/api/new-listings', async (req, res) => {
    try {
        const cacheKey = 'new-listings';
        let cachedData = cache.get(cacheKey);
        
        if (cachedData) {
            return res.json(cachedData);
        }
        
        const binanceData = await getBinanceData();
        
        // Simulamos nuevos listados (tokens con volumen bajo pero precio activo)
        const newListings = binanceData
            .filter(token => 
                parseFloat(token.quoteVolume) < 5000000 && 
                parseFloat(token.priceChangePercent) > -10 &&
                parseFloat(token.count) > 100
            )
            .map(token => {
                const analysis = ExplosionDetector.calculateExplosionScore(token);
                return {
                    symbol: token.symbol,
                    price: parseFloat(token.lastPrice),
                    priceChangePercent: parseFloat(token.priceChangePercent),
                    volume: parseFloat(token.quoteVolume),
                    score: analysis.totalScore,
                    recommendation: analysis.recommendation,
                    isNew: true,
                    timestamp: new Date().toISOString()
                };
            })
            .sort((a, b) => b.score - a.score)
            .slice(0, 5);
        
        cache.set(cacheKey, newListings);
        res.json(newListings);
        
    } catch (error) {
        console.error('Error en new-listings:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// 🧠 ENDPOINT: SMART ANALYSIS
app.get('/api/smart-analysis', async (req, res) => {
    try {
        const cacheKey = 'smart-analysis';
        let cachedData = cache.get(cacheKey);
        
        if (cachedData) {
            return res.json(cachedData);
        }
        
        const binanceData = await getBinanceData();
        
        const smartAnalysis = {
            explosionAlerts: [],
            safeInvestments: [],
            riskWarnings: [],
            marketSentiment: 'NEUTRAL',
            timestamp: new Date().toISOString()
        };
        
        // Análisis de explosiones
        const explosions = binanceData
            .filter(token => parseFloat(token.priceChangePercent) > 15)
            .map(token => {
                const analysis = ExplosionDetector.calculateExplosionScore(token);
                return { ...token, analysis };
            })
            .sort((a, b) => b.analysis.totalScore - a.analysis.totalScore)
            .slice(0, 3);
        
        smartAnalysis.explosionAlerts = explosions.map(token => ({
            symbol: token.symbol,
            price: parseFloat(token.lastPrice),
            change: parseFloat(token.priceChangePercent),
            volume: parseFloat(token.quoteVolume),
            score: token.analysis.totalScore,
            recommendation: token.analysis.recommendation,
            alert: `🔥 ${token.symbol} subió ${token.priceChangePercent}% con score ${token.analysis.totalScore}/100`
        }));
        
        // Inversiones seguras
        const safeTokens = binanceData
            .filter(token => 
                parseFloat(token.priceChangePercent) > 2 && 
                parseFloat(token.priceChangePercent) < 8 &&
                parseFloat(token.quoteVolume) > 10000000
            )
            .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
            .slice(0, 3);
        
        smartAnalysis.safeInvestments = safeTokens.map(token => {
            const analysis = ExplosionDetector.calculateExplosionScore(token);
            return {
                symbol: token.symbol,
                price: parseFloat(token.lastPrice),
                change: parseFloat(token.priceChangePercent),
                volume: parseFloat(token.quoteVolume),
                score: analysis.totalScore,
                recommendation: analysis.recommendation,
                reason: `Crecimiento estable del ${token.priceChangePercent}%`
            };
        });
        
        // Análisis de sentimiento del mercado
        const positiveTokens = binanceData.filter(t => parseFloat(t.priceChangePercent) > 0).length;
        const totalTokens = binanceData.length;
        const bullishPercentage = (positiveTokens / totalTokens) * 100;
        
        if (bullishPercentage > 60) smartAnalysis.marketSentiment = 'BULLISH';
        else if (bullishPercentage < 40) smartAnalysis.marketSentiment = 'BEARISH';
        else smartAnalysis.marketSentiment = 'NEUTRAL';
        
        smartAnalysis.marketStats = {
            totalTokens,
            positiveTokens,
            bullishPercentage: bullishPercentage.toFixed(1),
            avgChange: (binanceData.reduce((sum, token) => sum + parseFloat(token.priceChangePercent), 0) / totalTokens).toFixed(2)
        };
        
        cache.set(cacheKey, smartAnalysis);
        res.json(smartAnalysis);
        
    } catch (error) {
        console.error('Error en smart-analysis:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ⚡ ENDPOINT: HEALTH CHECK
app.get('/api/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        env: process.env.NODE_ENV || 'development',
        endpoints: [
            '/api/explosion-candidates',
            '/api/top-gainers',
            '/api/new-listings',
            '/api/smart-analysis',
            '/api/health'
        ]
    });
});

// Health check adicional para Railway
app.get('/health', (req, res) => res.status(200).send('OK'));
app.get('/', (req, res) => {
    res.status(200).json({
        message: '🚀 BoostIQ Crypto API - Sistema de Detección de Explosiones',
        status: 'Running',
        version: '2.0.0'
    });
});

// 🚀 INICIAR SERVIDOR
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 BoostIQ Crypto API corriendo en puerto ${PORT}`);
    console.log(`📈 Endpoints disponibles:`);
    console.log(`   - Explosion Candidates: /api/explosion-candidates`);
    console.log(`   - Top Gainers: /api/top-gainers`);
    console.log(`   - New Listings: /api/new-listings`);
    console.log(`   - Smart Analysis: /api/smart-analysis`);
    console.log(`   - Health: /api/health`);
});

module.exports = app;
