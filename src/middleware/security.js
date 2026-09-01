const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

function setupSecurity(app) {
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }));

  app.use((req, res, next) => {
    if (req.path === '/api/health') return next();
    rateLimit({
      windowMs: 1 * 60 * 1000,
      max: 500,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => req.ip || 'unknown',
    })(req, res, next);
  });

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: 'Too many attempts, try again later' },
  });
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/register', authLimiter);

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
}

module.exports = { setupSecurity };
