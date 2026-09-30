const fs = require('fs');
const path = require('path');

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const { authenticate } = require('./middleware/auth');

const app = express();

app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: config.frontendUrl === '*' ? true : config.frontendUrl.split(',') }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

if (!config.isTest) {
  app.use(morgan(config.isProduction ? 'combined' : 'dev'));
}

// Credential endpoints get a tighter budget than the rest of the API.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.isTest ? 0 : 20,
  message: { error: 'Too many attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => config.isTest,
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => config.isTest,
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: config.appName, timestamp: new Date().toISOString() });
});

app.use('/api', apiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/reset-password', authLimiter);

app.use('/api/auth', require('./routes/auth'));
app.use('/api/meta', authenticate, require('./routes/meta'));
app.use('/api/tickets', require('./routes/tickets'));
app.use('/api/users', require('./routes/users'));
app.use('/api/reports', require('./routes/reports'));

// Optionally serve the built frontend from the API. Everything then lives on
// one origin, which is what the devcontainer uses.
if (config.serveFrontend) {
  const buildDir = path.join(__dirname, '..', 'frontend', 'build');
  const indexHtml = path.join(buildDir, 'index.html');

  if (fs.existsSync(indexHtml)) {
    app.use(express.static(buildDir));

    // SPA fallback: a GET outside /api returns index.html so that deep links
    // like /tickets/12 are routed by React rather than 404ing here.
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      return res.sendFile(indexHtml);
    });
  } else {
    console.warn(
      'SERVE_FRONTEND=true but frontend/build is missing. '
      + 'Run `npm run build` in frontend/ first.',
    );
  }
}

app.use(notFound);
app.use(errorHandler);

module.exports = app;
