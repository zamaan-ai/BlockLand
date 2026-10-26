import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import { errorHandler } from './middleware/errorHandler';
import { isFrontendOriginAllowed } from './lib/frontendOrigin';
import { userRateLimit } from './middleware/userRateLimit';
import { swaggerSpec } from './config/swagger';
import './workers/documentWorker';

import authRoutes from './routes/auth.routes';
import landsRoutes from './routes/lands.routes';
import adminRoutes from './routes/admin.routes';
import documentsRoutes from './routes/documents.routes';
import verificationRoutes from './routes/verification.routes';
import transferRoutes from './routes/transfers.routes';
import projectRoutes from './routes/projects.routes';
import fractionalRoutes from './routes/fractional.routes';
import meRoutes from './routes/me.routes';
import builderRoutes from './routes/builders.routes';
import engagementRoutes from './routes/engagement.routes';
import dashboardRoutes from './routes/dashboard.routes';
import verificationReportRoutes from './routes/verification-report.routes';

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: (origin, callback) => {
    if (isFrontendOriginAllowed(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`Origin ${origin} is not allowed by CORS`));
    }
  },
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
});
app.use('/api/v1/auth', authLimiter);

/**
 * @openapi
 * /health:
 *   get:
 *     summary: Health check
 *     tags: [System]
 *     security: []
 */
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/api/v1/docs.json', (_req, res) => res.json(swaggerSpec));
app.use('/api/v1/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/lands', landsRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/documents', userRateLimit(40, 60_000), documentsRoutes);
app.use('/api/v1/verification', verificationRoutes);
app.use('/api/v1/transfers', userRateLimit(40, 60_000), transferRoutes);
app.use('/api/v1/projects', projectRoutes);
app.use('/api/v1/fractional', fractionalRoutes);
app.use('/api/v1/me', userRateLimit(80, 60_000), meRoutes);
app.use('/api/v1/builders', builderRoutes);
app.use('/api/v1/engagement', engagementRoutes);
app.use('/api/v1/verification-report', verificationReportRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);

app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Not Found' });
});

app.use(errorHandler);

export default app;
