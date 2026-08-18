import { type NextRequest } from 'next/server';

import { createLogger } from '@/lib/chromia/logger';

import { apiError } from './response';

const log = createLogger('api');

type RouteHandler<Ctx> = (request: NextRequest, context: Ctx) => Promise<Response> | Response;

/**
 * Wraps a Route Handler with centralised error translation and logging.
 * Handlers can therefore throw `AppError` subclasses freely and stay readable.
 *
 *   export const GET = withErrorHandling(async (req) => { ... });
 */
export function withErrorHandling<Ctx>(handler: RouteHandler<Ctx>): RouteHandler<Ctx> {
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (error) {
      log.error({ err: error, url: request.nextUrl.pathname }, 'Unhandled route error');
      return apiError(error);
    }
  };
}
