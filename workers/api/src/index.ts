import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { verifyCsrfAndOrigin } from './middleware/csrf';
import { authRouter } from './auth/routes';
import { providersRouter } from './routes/providers';
import { conversationsRouter } from './routes/conversations';
import { memoryRouter } from './routes/memory';
import { projectsRouter } from './routes/projects';

export interface Env {
  DB: D1Database;
  ENCRYPTION_SECRET: string;
  SESSION_SECRET: string;
  ENVIRONMENT: string;
  CLIENT_ORIGIN?: string;
}

const app = new Hono<{ Bindings: Env }>();

app.use('*', logger());

// Explicit CORS configuration with strict origins - no wildcards with credentials
app.use('*', async (c, next) => {
  const allowedOrigins = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ];
  if (c.env.CLIENT_ORIGIN && !allowedOrigins.includes(c.env.CLIENT_ORIGIN)) {
    allowedOrigins.push(c.env.CLIENT_ORIGIN);
  }

  const originHeader = c.req.header('Origin');
  const allowedOrigin = originHeader && allowedOrigins.includes(originHeader)
    ? originHeader
    : allowedOrigins[0];

  const corsMiddleware = cors({
    origin: allowedOrigin,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'Cookie'],
    credentials: true,
  });
  return corsMiddleware(c, next);
});

// Modern Security response headers middleware
app.use('*', async (c, next) => {
  await next();
  // 1. Content Security Policy for React/Vite SPA
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'", // required for Tailwind / inline theme styles
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' http://localhost:5173 http://localhost:8787 " + (c.env.CLIENT_ORIGIN || ''),
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');

  c.header('Content-Security-Policy', csp);
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  // Note: Legacy X-XSS-Protection header deliberately omitted as per modern web standards
});

// CSRF & Origin protection middleware for state-changing endpoints
app.use('*', verifyCsrfAndOrigin);

// Health check endpoint
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    platform: 'EvolveAI',
    environment: c.env.ENVIRONMENT || 'development',
    timestamp: new Date().toISOString(),
  });
});

// Root information endpoint
app.get('/', (c) => {
  return c.json({
    name: 'EvolveAI API',
    version: '0.1.0',
    description: 'Personal, Model-Agnostic, Self-Evolving AI Intelligence Platform',
    endpoints: {
      health: '/health',
      auth: '/auth/*',
      providers: '/providers/*',
      chat: '/conversations/*',
      memory: '/memory/*',
      projects: '/projects/*',
    },
  });
});

// Mount modular sub-routers
app.route('/auth', authRouter);
app.route('/providers', providersRouter);
app.route('/conversations', conversationsRouter);
app.route('/memory', memoryRouter);
app.route('/projects', projectsRouter);

// Error handling
app.onError((err, c) => {
  console.error('Unhandled API Error:', err);
  return c.json(
    {
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: err.message || 'An unexpected error occurred',
      },
    },
    500
  );
});

export default app;
