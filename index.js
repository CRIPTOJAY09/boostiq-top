const express = require("express");
const axios = require("axios");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const app = express();

// Configuración optimizada para señales de trading
const CONFIG = {
  MIN_VOLUME_EXPLOSION: 100000, // Mayor volumen para explosiones
  MIN_VOLUME_REGULAR: 50000,
  MIN_GAIN_EXPLOSION: 8, // Mínimo 8% para explosiones
  MIN_GAIN_REGULAR: 5,
  TOP_COUNT: 5, // Siempre top 5 para tu servicio
  BINANCE_API_URL: "https://api.binance.com/api/v3/ticker/24hr",
  BINANCE_KLINES_URL: "https://api.binance.com/api/v3/klines",
  CACHE_DURATION: 30000, // 30 segundos - más frecuente para trading
  REQUEST_TIMEOUT: 10000,
  PORT: process.env.PORT || 3000
};

// Cache inteligente para diferentes endpoints
let explosionCache = null;
let regularCache = null;
let newListingsCache = null;
let lastExplosionFetch = 0;
let lastRegularFetch = 0;
let lastNewListingsFetch = 0;

// Middlewares
app.use(cors({ origin: '*' }));
app.use(express.json());

// Rate limiting más permisivo para tu servicio
const limiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutos
  max: 200, // 200 requests por IP
  message: { error: "Rate limit exceeded" }
});
app.use("/api/", limiter);

// Función para calcular RSI simplificado
const calculateSimpleRSI = (prices) => {
  if (prices.length < 14) return 50; // Valor neutral si no hay suficientes datos
  
  const gains = [];
  const losses = [];
  
  for (let i = 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) {
      gains.push(change);
      losses.push(0);
    } else {
      gains.push(0);
      losses.push(Math.abs(change));
    }
  }
  
  const avgGain = gains.slice(-14).reduce((a, b) => a + b, 0) / 14;
  const avgLoss = losses.slice(-14).reduce((a, b) => a + b, 0) / 14;
  
  if (avgLoss === 0) return 100;
  
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
};

// Función para calcular momentum
const calculateMomentum = (prices) => {
  if (prices.length < 5) return 0;
  
  const recent = prices.slice(-5);
  const older = prices.slice(-10, -5);
  
  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
  
  return ((recentAvg - olderAvg) / olderAvg) * 100;
};

// Función para detectar picos de volumen
const detectVolumeSpike = (currentVolume, avgVolume) => {
  return currentVolume > (avgVolume * 2); // Pico si es 2x el promedio
};

// Función para scoring inteligente
const calculateTokenScore = (token, avgVolume = 0) => {
  let score = 0;
  
  // Puntuación por ganancia (máximo 3 puntos)
  const gainPercent = parseFloat(token.percentChange);
  if (gainPercent >= 15) score += 3;
  else if (gainPercent >= 10) score += 2;
  else if (gainPercent >= 5) score += 1;
  
  // Puntuación por volumen (máximo 2 puntos)
  const volume = parseFloat(token.volume);
  if (volume >= 500000) score += 2;
  else if (volume >= 200000) score += 1;
  
  // Puntuación por pico de volumen (máximo 2 puntos)
  if (avgVolume > 0 && detectVolumeSpike(volume, avgVolume)) {
    score += 2;
  }
  
  // Puntuación por momentum (máximo 2 puntos)
  if (token.momentum > 5) score += 2;
  else if (token.momentum > 0) score += 1;
  
  // Puntuación por RSI saludable (máximo 1 punto)
  if (token.rsi >= 30 && token.rsi <= 70) score += 1;
  
  return Math.min(score, 10); // Máximo 10 puntos
};

// Función para obtener datos de klines (para RSI y momentum)
const getKlineData = async (symbol, interval = '1h', limit = 100) => {
  try {
    const response = await axios.get(CONFIG.BINANCE_KLINES_URL, {
      params: { symbol, interval, limit },
      timeout: CONFIG.REQUEST_TIMEOUT
    });
    
    return response.data.map(kline => parseFloat(kline[4])); // Close prices
  } catch (error) {
    console.error(`Error getting kline data for ${symbol}:`, error.message);
    return [];
  }
};

// Función principal para procesar tokens con análisis técnico
const processTokensWithAnalysis = async (data, minVolume, minGain) => {
  if (!Array.isArray(data)) {
    throw new Error("Invalid data format from Binance API");
  }

  // Filtrado inicial
  const filteredTokens = data
    .filter(item => item && typeof item === 'object')
    .filter(item => ['symbol', 'lastPrice', 'priceChangePercent', 'quoteVolume'].every(field => 
      item[field] !== undefined && item[field] !== null))
    .filter(item => item.symbol?.endsWith("USDT"))
    .filter(item => {
      const volume = parseFloat(item.quoteVolume);
      const gain = parseFloat(item.priceChangePercent);
      return !isNaN(volume) && volume > minVolume && !isNaN(gain) && gain > minGain;
    });

  // Calcular volumen promedio para detección de picos
  const avgVolume = filteredTokens.reduce((sum, token) => 
    sum + parseFloat(token.quoteVolume), 0) / filteredTokens.length;

  // Procesar tokens con análisis técnico
  const processedTokens = [];
  
  for (const item of filteredTokens.slice(0, 50)) { // Limitar para evitar rate limits
    const prices = await getKlineData(item.symbol);
    
    const token = {
      symbol: item.symbol,
      price: parseFloat(item.lastPrice).toFixed(8),
      percentChange: parseFloat(item.priceChangePercent).toFixed(2),
      volume: parseFloat(item.quoteVolume).toFixed(2),
      priceChange: parseFloat(item.priceChange).toFixed(8),
      rsi: calculateSimpleRSI(prices),
      momentum: calculateMomentum(prices),
      volumeSpike: detectVolumeSpike(parseFloat(item.quoteVolume), avgVolume),
      score: 0 // Se calculará después
    };
    
    token.score = calculateTokenScore(token, avgVolume);
    processedTokens.push(token);
  }

  // Ordenar por score y después por ganancia
  return processedTokens
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return parseFloat(b.percentChange) - parseFloat(a.percentChange);
    })
    .slice(0, CONFIG.TOP_COUNT);
};

// Función para detectar nuevos listados
const detectNewListings = (data) => {
  // Filtrar tokens con volumen bajo pero ganancia alta (posibles nuevos listados)
  return data
    .filter(item => item && typeof item === 'object')
    .filter(item => item.symbol?.endsWith("USDT"))
    .filter(item => {
      const volume = parseFloat(item.quoteVolume);
      const gain = parseFloat(item.priceChangePercent);
      const price = parseFloat(item.lastPrice);
      
      // Criterios para nuevos listados
      return volume < 200000 && // Volumen relativamente bajo
             gain > 20 && // Ganancia alta
             price > 0.001; // Precio no micro
    })
    .map(item => ({
      symbol: item.symbol,
      price: parseFloat(item.lastPrice).toFixed(8),
      percentChange: parseFloat(item.priceChangePercent).toFixed(2),
      volume: parseFloat(item.quoteVolume).toFixed(2),
      possibleNewListing: true,
      riskLevel: "HIGH" // Nuevos listados son alto riesgo
    }))
    .sort((a, b) => parseFloat(b.percentChange) - parseFloat(a.percentChange))
    .slice(0, CONFIG.TOP_COUNT);
};

// ENDPOINTS PRINCIPALES

// 1. Página de bienvenida
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "🚀 Professional Trading Signals API",
    version: "2.0.0",
    endpoints: {
      explosionCandidates: "/api/explosion-candidates",
      topGainers: "/api/top-gainers",
      newListings: "/api/new-listings",
      smartAnalysis: "/api/smart-analysis",
      health: "/api/health"
    },
    description: "Advanced crypto trading signals with technical analysis"
  });
});

// 2. EXPLOSION CANDIDATES - Los mejores 5 para explosiones
app.get("/api/explosion-candidates", async (req, res) => {
  try {
    const now = Date.now();
    if (explosionCache && (now - lastExplosionFetch) < CONFIG.CACHE_DURATION) {
      return res.json({
        success: true,
        data: explosionCache,
        cached: true,
        timestamp: new Date(lastExplosionFetch).toISOString()
      });
    }

    console.log("🔥 Fetching explosion candidates...");
    const { data } = await axios.get(CONFIG.BINANCE_API_URL, {
      timeout: CONFIG.REQUEST_TIMEOUT
    });

    const candidates = await processTokensWithAnalysis(
      data, 
      CONFIG.MIN_VOLUME_EXPLOSION, 
      CONFIG.MIN_GAIN_EXPLOSION
    );

    explosionCache = candidates;
    lastExplosionFetch = now;

    res.json({
      success: true,
      data: candidates,
      cached: false,
      timestamp: new Date().toISOString(),
      total: candidates.length,
      type: "EXPLOSION_CANDIDATES"
    });

  } catch (error) {
    console.error("Error fetching explosion candidates:", error.message);
    res.status(500).json({
      success: false,
      error: "Failed to fetch explosion candidates",
      message: error.message
    });
  }
});

// 3. TOP GAINERS - Los mejores 5 regulares
app.get("/api/top-gainers", async (req, res) => {
  try {
    const now = Date.now();
    if (regularCache && (now - lastRegularFetch) < CONFIG.CACHE_DURATION) {
      return res.json({
        success: true,
        data: regularCache,
        cached: true,
        timestamp: new Date(lastRegularFetch).toISOString()
      });
    }

    console.log("📈 Fetching top gainers...");
    const { data } = await axios.get(CONFIG.BINANCE_API_URL, {
      timeout: CONFIG.REQUEST_TIMEOUT
    });

    const gainers = await processTokensWithAnalysis(
      data,
      CONFIG.MIN_VOLUME_REGULAR,
      CONFIG.MIN_GAIN_REGULAR
    );

    regularCache = gainers;
    lastRegularFetch = now;

    res.json({
      success: true,
      data: gainers,
      cached: false,
      timestamp: new Date().toISOString(),
      total: gainers.length,
      type: "TOP_GAINERS"
    });

  } catch (error) {
    console.error("Error fetching top gainers:", error.message);
    res.status(500).json({
      success: false,
      error: "Failed to fetch top gainers",
      message: error.message
    });
  }
});

// 4. NEW LISTINGS - Posibles nuevos listados
app.get("/api/new-listings", async (req, res) => {
  try {
    const now = Date.now();
    if (newListingsCache && (now - lastNewListingsFetch) < CONFIG.CACHE_DURATION) {
      return res.json({
        success: true,
        data: newListingsCache,
        cached: true,
        timestamp: new Date(lastNewListingsFetch).toISOString()
      });
    }

    console.log("🆕 Detecting new listings...");
    const { data } = await axios.get(CONFIG.BINANCE_API_URL, {
      timeout: CONFIG.REQUEST_TIMEOUT
    });

    const newListings = detectNewListings(data);

    newListingsCache = newListings;
    lastNewListingsFetch = now;

    res.json({
      success: true,
      data: newListings,
      cached: false,
      timestamp: new Date().toISOString(),
      total: newListings.length,
      type: "NEW_LISTINGS"
    });

  } catch (error) {
    console.error("Error detecting new listings:", error.message);
    res.status(500).json({
      success: false,
      error: "Failed to detect new listings",
      message: error.message
    });
  }
});

// 5. SMART ANALYSIS - Análisis completo combinado
app.get("/api/smart-analysis", async (req, res) => {
  try {
    console.log("🧠 Performing smart analysis...");
    const { data } = await axios.get(CONFIG.BINANCE_API_URL, {
      timeout: CONFIG.REQUEST_TIMEOUT
    });

    const [explosionCandidates, regularGainers, newListings] = await Promise.all([
      processTokensWithAnalysis(data, CONFIG.MIN_VOLUME_EXPLOSION, CONFIG.MIN_GAIN_EXPLOSION),
      processTokensWithAnalysis(data, CONFIG.MIN_VOLUME_REGULAR, CONFIG.MIN_GAIN_REGULAR),
      Promise.resolve(detectNewListings(data))
    ]);

    res.json({
      success: true,
      data: {
        explosionCandidates: explosionCandidates.slice(0, 3),
        regularGainers: regularGainers.slice(0, 3),
        newListings: newListings.slice(0, 2)
      },
      timestamp: new Date().toISOString(),
      type: "SMART_ANALYSIS"
    });

  } catch (error) {
    console.error("Error in smart analysis:", error.message);
    res.status(500).json({
      success: false,
      error: "Failed to perform smart analysis",
      message: error.message
    });
  }
});

// 6. Health check
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    caches: {
      explosion: {
        hasData: !!explosionCache,
        lastFetch: lastExplosionFetch ? new Date(lastExplosionFetch).toISOString() : null
      },
      regular: {
        hasData: !!regularCache,
        lastFetch: lastRegularFetch ? new Date(lastRegularFetch).toISOString() : null
      },
      newListings: {
        hasData: !!newListingsCache,
        lastFetch: lastNewListingsFetch ? new Date(lastNewListingsFetch).toISOString() : null
      }
    }
  });
});

// Manejo de errores
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint not found",
    availableEndpoints: [
      "GET /api/explosion-candidates",
      "GET /api/top-gainers", 
      "GET /api/new-listings",
      "GET /api/smart-analysis",
      "GET /api/health"
    ]
  });
});

app.use((error, req, res, next) => {
  console.error("Unhandled error:", error);
  res.status(500).json({
    success: false,
    error: "Internal server error"
  });
});

// Iniciar servidor
const server = app.listen(CONFIG.PORT, () => {
  console.log(`🚀 Trading Signals API running on port ${CONFIG.PORT}`);
  console.log(`💎 Professional crypto signals ready`);
  console.log(`📊 Endpoints: explosion-candidates, top-gainers, new-listings, smart-analysis`);
});

module.exports = app;
