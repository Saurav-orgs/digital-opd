import { SetMetadata } from '@nestjs/common';
import { PermissionAction, PermissionModule } from '../enums';

export const PERMISSIONS_KEY = 'requiredPermissions';

export interface RequiredPermission {
  module: PermissionModule;
  action: PermissionAction;
}

/**
 * Guards a route behind a `module:action` grant. Abilities are always driven by
 * the user's role permissions — this applies to doctors too (plan §2).
 *
 * @example @Permissions({ module: PermissionModule.DOCTORS, action: PermissionAction.UPDATE })
 */
export const Permissions = (...perms: RequiredPermission[]) =>
  SetMetadata(PERMISSIONS_KEY, perms);
