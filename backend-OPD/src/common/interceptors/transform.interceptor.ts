import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { RAW_RESPONSE_KEY } from '../decorators/raw-response.decorator';

export interface SuccessEnvelope<T> {
  success: true;
  statusCode: number;
  data: T;
  timestamp: string;
}

/**
 * Wraps successful responses in a consistent envelope so the clients can rely
 * on `success` across every endpoint. Handlers marked @RawResponse() (e.g.
 * file streams / redirects) pass through untouched.
 */
@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, SuccessEnvelope<T> | T>
{
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<SuccessEnvelope<T> | T> {
    const isRaw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isRaw) return next.handle();

    const res = context.switchToHttp().getResponse();
    return next.handle().pipe(
      map((data) => ({
        success: true as const,
        statusCode: res.statusCode,
        data,
        timestamp: new Date().toISOString(),
      })),
    );
  }
}
