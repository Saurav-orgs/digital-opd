import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { createHash } from 'crypto';

/**
 * Rate limiting counted per signed-in session rather than per IP address.
 *
 * A clinic is one public IP. Counting every request from it against a single
 * bucket means the receptionist booking walk-ins can lock the doctor out of
 * their own consultation — the busiest, most legitimate user is the one who
 * trips it, and nothing about that is protective.
 *
 * The bearer token identifies the session, and it is on the request before any
 * of it is parsed, which matters because this guard runs ahead of
 * authentication. It is hashed, never stored or logged: this class only needs
 * to tell two callers apart, not know who either of them is.
 *
 * Anonymous traffic still falls back to the IP, which is where per-IP limiting
 * is the right shape — the public booking and patient-OTP routes carry their
 * own much tighter `@Throttle` on top of this.
 */
@Injectable()
export class SessionThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const header: unknown = req.headers?.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      const token = header.slice('Bearer '.length).trim();
      if (token) {
        return `session:${createHash('sha256').update(token).digest('hex').slice(0, 32)}`;
      }
    }

    const ip = Array.isArray(req.ips) && req.ips.length ? req.ips[0] : req.ip;
    return `ip:${ip ?? 'unknown'}`;
  }
}
