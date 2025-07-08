const express = require("express");
const axios = require("axios");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const app = express();

// Configuración
const CONFIG = {
  MIN_VOLUME: 50000,
  MIN_GAIN_PERCENT: 5,
  TOP_COUNT: 10,
  BINANCE_API_URL: "https://api.binance.com/api/v3/ticker/24hr",
  CACHE_DURATION: 60000, // 1 minuto
  REQUEST_TIMEOUT: 10000, // 10 segundos
  PORT: process.env.PORT || 3000
};

// Cache simple en memoria
let cache = null;
let lastFetch = 0;

// Middlewares
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
  credentials: true
}));

app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // límite de requests por IP
  message: {
    error: "Too many requests from this IP, please try again later"
  },
  standardHeaders: true,
  legacyHeaders: false
});

app.use("/api/", limiter);

// Función para validar datos de Binance
const validateBinanceData = (item) => {
  if (!item || typeof item !== 'object') return false;
  
  const requiredFields = ['symbol', 'lastPrice', 'priceChangePercent', 'quoteVolume'];
  return requiredFields.every(field => item[field] !== undefined && item[field] !== null);
};

// Función para procesar datos de Binance
const processGainersData = (data) => {
  if (!Array.isArray(data)) {
    throw new Error("Invalid data format from Binance API");
  }

  return data
    .filter(item => validateBinanceData(item))
    .filter(item => item.symbol?.endsWith("USDT"))
    .filter(item => {
      const volume = parseFloat(item.quoteVolume);
      return !isNaN(volume) && volume > CONFIG.MIN_VOLUME;
    })
    .map(item => {
      const price = parseFloat(item.lastPrice);
      const percentChange = parseFloat(item.priceChangePercent);
      const volume = parseFloat(item.quoteVolume);
      
      return {
        symbol: item.symbol,
        price: price.toFixed(8),
        percentChange: percentChange.toFixed(2),
        volume: volume.toFixed(2),
        priceChange: parseFloat(item.priceChange).toFixed(8)
      };
    })
    .filter(item => {
      const percentChange = parseFloat(item.percentChange);
      return !isNaN(percentChange) && percentChange > CONFIG.MIN_GAIN_PERCENT;
    })
    .sort((a, b) => parseFloat(b.percentChange) - parseFloat(a.percentChange))
    .slice(0, CONFIG.TOP_COUNT);
};

// Endpoint principal
app.get("/api/top-gainers", async (req, res) => {
  try {
    // Verificar cache
    const now = Date.now();
    if (cache && (now - lastFetch) < CONFIG.CACHE_DURATION) {
      return res.json({
        success: true,
        data: cache,
        cached: true,
        timestamp: new Date(lastFetch).toISOString()
      });
    }

    console.log("Fetching fresh data from Binance API...");

    // Fetch datos de Binance
    const { data } = await axios.get(CONFIG.BINANCE_API_URL, {
      timeout: CONFIG.REQUEST_TIMEOUT,
      headers: {
        'User-Agent': 'Binance-Top-Gainers-API/1.0'
      }
    });

    // Procesar datos
    const gainers = processGainersData(data);

    // Actualizar cache
    cache = gainers;
    lastFetch = now;

    // Respuesta exitosa
    res.json({
      success: true,
      data: gainers,
      cached: false,
      timestamp: new Date().toISOString(),
      total: gainers.length
    });

  } catch (error) {
    console.error("Error fetching Binance data:", error.message);

    // Manejo específico de errores
    if (error.code === 'ECONNABORTED') {
      return res.status(408).json({
        success: false,
        error: "Request timeout - Binance API is taking too long to respond"
      });
    }

    if (error.response) {
      // Error de la API de Binance
      return res.status(error.response.status).json({
        success: false,
        error: "Binance API error",
        details: error.response.data || "Unknown API error"
      });
    }

    if (error.request) {
      // Error de red
      return res.status(503).json({
        success: false,
        error: "Network error - Unable to reach Binance API"
      });
    }

    // Error interno
    res.status(500).json({
      success: false,
      error: "Internal server error",
      message: process.env.NODE_ENV === 'development' ? error.message : "Something went wrong"
    });
  }
});

// Endpoint de salud
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    cache: {
      hasData: !!cache,
      lastFetch: lastFetch ? new Date(lastFetch).toISOString() : null,
      age: lastFetch ? Date.now() - lastFetch : null
    }
  });
});

// Endpoint para configuración (solo en desarrollo)
app.get("/api/config", (req, res) => {
  if (process.env.NODE_ENV !== 'development') {
    return res.status(404).json({ error: "Not found" });
  }
  
  res.json({
    success: true,
    config: {
      MIN_VOLUME: CONFIG.MIN_VOLUME,
      MIN_GAIN_PERCENT: CONFIG.MIN_GAIN_PERCENT,
      TOP_COUNT: CONFIG.TOP_COUNT,
      CACHE_DURATION: CONFIG.CACHE_DURATION,
      REQUEST_TIMEOUT: CONFIG.REQUEST_TIMEOUT
    }
  });
});

// Endpoint para limpiar cache (útil para desarrollo)
app.post("/api/clear-cache", (req, res) => {
  if (process.env.NODE_ENV !== 'development') {
    return res.status(404).json({ error: "Not found" });
  }
  
  cache = null;
  lastFetch = 0;
  
  res.json({
    success: true,
    message: "Cache cleared successfully"
  });
});

// Manejo de rutas no encontradas
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint not found",
    availableEndpoints: [
      "GET /api/top-gainers",
      "GET /api/health"
    ]
  });
});

// Manejo global de errores
app.use((error, req, res, next) => {
  console.error("Unhandled error:", error);
  res.status(500).json({
    success: false,
    error: "Internal server error"
  });
});

// Manejo de señales para shutdown graceful
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// Iniciar servidor
const server = app.listen(CONFIG.PORT, () => {
  console.log(`🚀 Server running on port ${CONFIG.PORT}`);
  console.log(`📊 Binance Top Gainers API ready`);
  console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`⚙️  Config: MIN_VOLUME=${CONFIG.MIN_VOLUME}, MIN_GAIN=${CONFIG.MIN_GAIN_PERCENT}%`);
});

module.exports = app;
