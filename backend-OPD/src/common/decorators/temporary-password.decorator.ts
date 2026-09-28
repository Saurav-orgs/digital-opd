import { SetMetadata } from '@nestjs/common';

export const ALLOWS_TEMPORARY_PASSWORD_KEY = 'allowsTemporaryPassword';

/**
 * Marks a route an account on a temporary password may still call.
 *
 * Only what the change-password screen itself needs: reading who you are, and
 * setting the new password. Everything else is refused by
 * {@link TemporaryPasswordGuard} until the password has been replaced.
 */
export const AllowsTemporaryPassword = () =>
  SetMetadata(ALLOWS_TEMPORARY_PASSWORD_KEY, true);
