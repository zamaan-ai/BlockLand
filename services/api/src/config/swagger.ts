import swaggerJsdoc from 'swagger-jsdoc';

export const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'BlockLand API',
      version: '1.0.0',
      description: 'Land registry, verification, transfers, documents, and auth.',
    },
    servers: [{ url: '/api/v1', description: 'Versioned API' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ['./src/routes/*.ts', './src/app.ts'],
});
