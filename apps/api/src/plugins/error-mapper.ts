import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { HttpError } from '../lib/errors.js';

/** Maps thrown `HttpError`s (and anything else) to an RFC 7807 problem+json body. */
export const errorMapperPlugin: FastifyPluginAsync = fp((app) => {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      reply.code(error.status).type('application/problem+json').send({
        type: 'about:blank',
        title: error.message,
        status: error.status
      });
      return;
    }

    app.log.error(error);
    reply.code(500).type('application/problem+json').send({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500
    });
  });

  return Promise.resolve();
});
