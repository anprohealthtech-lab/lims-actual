// src/utils/permissions.ts
// Utility functions for checking user permissions

import { supabase } from './supabase';

/**
 * Get LIMS user by auth_user_id (Supabase Auth UUID) or by email
 * Returns the full user record from public.users table
 * Tries auth_user_id first, falls back to email lookup
 */
export async function getLimsUserByAuthId(authUserId: string, email?: string): Promise<{ id: string; role_id: string; permissions: string[] | null; whatsapp_sync_status: string | null } | null> {
  try {
    // First try by auth_user_id
    const { data: user } = await supabase
      .from('users')
      .select('id, role_id, permissions, whatsapp_sync_status')
      .eq('auth_user_id', authUserId)
      .maybeSingle();

    if (user) {
      return user;
    }

    // If not found and email provided, try by email
    // This handles cases where auth_user_id is not yet linked
    if (email) {
      const { data: userByEmail } = await supabase
        .from('users')
        .select('id, role_id, permissions, whatsapp_sync_status')
        .eq('email', email)
        .eq('status', 'Active')
        .maybeSingle();

      if (userByEmail) {
        console.log('Found user by email (auth_user_id not linked):', email);
        return userByEmail;
      }
    }

    console.warn('Could not find LIMS user for auth_user_id:', authUserId, 'email:', email);
    return null;
  } catch (error) {
    console.error('Error fetching LIMS user:', error);
    return null;
  }
}

/**
 * Get all permissions for a user based on their role AND extra permissions
 * Accepts LIMS user ID (UUID string), auth_user_id (UUID string), or email
 */
export async function getUserPermissions(userIdOrAuthId: string | number, email?: string): Promise<string[]> {
  try {
    let user: { role_id: string; permissions: string[] | null } | null = null;
    
    // Determine if this is a LIMS user ID or auth UUID (both are UUIDs with dashes)
    const isUuid = typeof userIdOrAuthId === 'string' && userIdOrAuthId.includes('-');
    
    if (isUuid) {
      // First try by users.id (LIMS user ID)
      const { data: userById } = await supabase
        .from('users')
        .select('role_id, permissions')
        .eq('id', userIdOrAuthId)
        .maybeSingle();
      
      if (userById) {
        user = userById;
      } else {
        // Then try by auth_user_id or email
        const limsUser = await getLimsUserByAuthId(userIdOrAuthId as string, email);
        if (limsUser) {
          user = { role_id: limsUser.role_id, permissions: limsUser.permissions };
        }
      }
    } else {
      // Look up by LIMS user id (numeric - legacy)
      const { data, error } = await supabase
        .from('users')
        .select('role_id, permissions')
        .eq('id', userIdOrAuthId)
        .single();
      
      if (!error && data) {
        user = data;
      }
    }

    if (!user?.role_id) {
      console.warn('Could not find role for user:', userIdOrAuthId);
      return user?.permissions || []; // Return just extra permissions if no role
    }

    // Get all permission codes for this role
    const { data: rolePermissions, error: permError } = await supabase
      .from('role_permissions')
      .select(`
        permissions!inner(permission_code)
      `)
      .eq('role_id', user.role_id);

    if (permError) {
      console.warn('Could not fetch permissions for role:', user.role_id);
    }

    const rolePerms = rolePermissions?.map((rp: any) => rp.permissions?.permission_code).filter(Boolean) || [];
    const extraPerms = user.permissions || [];
    
    // Combine role permissions and extra permissions (deduplicated)
    const allPerms = [...new Set([...rolePerms, ...extraPerms])];
    return allPerms;
  } catch (error) {
    console.error('Error fetching user permissions:', error);
    return [];
  }
}

/**
 * Check if user has a specific permission
 * Accepts LIMS user ID, auth_user_id (UUID string), or email
 */
export async function hasPermission(userIdOrAuthId: string | number, permissionCode: string, email?: string): Promise<boolean> {
  const permissions = await getUserPermissions(userIdOrAuthId, email);
  return permissions.includes(permissionCode);
}

/**
 * Check if user has the 'connect_whatsapp' permission
 * Accepts LIMS user ID, auth_user_id (UUID string), or email
 */
export async function canConnectWhatsApp(userIdOrAuthId: string | number, email?: string): Promise<boolean> {
  return hasPermission(userIdOrAuthId, 'connect_whatsapp', email);
}

/**
 * Check if user is synced to WhatsApp backend
 * Accepts LIMS user ID, auth_user_id (UUID string), or email
 */
export async function isUserSyncedToWhatsApp(userIdOrAuthId: string | number, email?: string): Promise<boolean> {
  try {
    // Determine lookup method
    const isUuid = typeof userIdOrAuthId === 'string' && userIdOrAuthId.includes('-');
    
    let user: { whatsapp_sync_status: string | null } | null = null;
    
    if (isUuid) {
      // First try by users.id
      const { data: userById } = await supabase
        .from('users')
        .select('whatsapp_sync_status')
        .eq('id', userIdOrAuthId)
        .maybeSingle();
      
      if (userById) {
        user = userById;
      } else {
        // Try by auth_user_id or email
        const limsUser = await getLimsUserByAuthId(userIdOrAuthId as string, email);
        if (limsUser) {
          user = { whatsapp_sync_status: limsUser.whatsapp_sync_status };
        }
      }
    } else {
      const { data, error } = await supabase
        .from('users')
        .select('whatsapp_sync_status')
        .eq('id', userIdOrAuthId)
        .single();
      
      if (!error && data) {
        user = data;
      }
    }

    if (!user) return false;
    return user.whatsapp_sync_status === 'synced';
  } catch {
    return false;
  }
}

/**
 * Sync user to WhatsApp backend if they have permission
 * Called when connect_whatsapp permission is granted
 * Accepts LIMS user ID, auth_user_id (UUID string), or email
 */
export async function syncUserToWhatsAppIfNeeded(userIdOrAuthId: string | number, email?: string): Promise<{ success: boolean; message: string }> {
  try {
    // Get LIMS user for the sync call
    let limsUserId: string;
    const isUuid = typeof userIdOrAuthId === 'string' && userIdOrAuthId.includes('-');
    
    if (isUuid) {
      // First try by users.id
      const { data: userById } = await supabase
        .from('users')
        .select('id')
        .eq('id', userIdOrAuthId)
        .maybeSingle();
      
      if (userById) {
        limsUserId = userById.id;
      } else {
        // Try by auth_user_id or email
        const limsUser = await getLimsUserByAuthId(userIdOrAuthId as string, email);
        if (!limsUser) {
          return { success: false, message: 'Could not find LIMS user' };
        }
        limsUserId = limsUser.id;
      }
    } else {
      limsUserId = String(userIdOrAuthId);
    }
    
    // Check if user has permission
    const hasConnectPermission = await canConnectWhatsApp(userIdOrAuthId, email);
    if (!hasConnectPermission) {
      return { success: false, message: 'User does not have connect_whatsapp permission' };
    }

    // Check if already synced
    const alreadySynced = await isUserSyncedToWhatsApp(userIdOrAuthId, email);
    if (alreadySynced) {
      return { success: true, message: 'User already synced' };
    }

    // Call the sync Edge Function with LIMS user ID
    const { data, error } = await supabase.functions.invoke('sync-user-to-whatsapp', {
      body: { userId: limsUserId }
    });

    if (error) {
      console.error('WhatsApp sync error:', error);
      return { success: false, message: error.message || 'Sync failed' };
    }

    return { success: true, message: data?.message || 'User synced successfully' };
  } catch (error) {
    console.error('Error syncing user to WhatsApp:', error);
    return { success: false, message: 'Unexpected error during sync' };
  }
}

/**
 * Get user's role code (admin, receptionist, etc.)
 * Accepts LIMS user ID (UUID string), auth_user_id (UUID string), or email
 */
export async function getUserRoleCode(userIdOrAuthId: string, email?: string): Promise<string | null> {
  try {
    // First try by users.id
    let result = await supabase
      .from('users')
      .select('user_roles!inner(role_code)')
      .eq('id', userIdOrAuthId)
      .maybeSingle();
    
    if (result.data) {
      return (result.data as any).user_roles?.role_code || null;
    }
    
    // Try by auth_user_id
    result = await supabase
      .from('users')
      .select('user_roles!inner(role_code)')
      .eq('auth_user_id', userIdOrAuthId)
      .maybeSingle();
    
    if (result.data) {
      return (result.data as any).user_roles?.role_code || null;
    }
    
    // Try by email if provided
    if (email) {
      result = await supabase
        .from('users')
        .select('user_roles!inner(role_code)')
        .eq('email', email)
        .eq('status', 'Active')
        .maybeSingle();
      
      if (result.data) {
        return (result.data as any).user_roles?.role_code || null;
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error getting user role code:', error);
    return null;
  }
}

/**
 * Check if user is an admin
 * Accepts LIMS user ID (UUID string), auth_user_id (UUID string), or email
 */
export async function isAdmin(userIdOrAuthId: string, email?: string): Promise<boolean> {
  const roleCode = await getUserRoleCode(userIdOrAuthId, email);
  return roleCode === 'admin';
}

/**
 * Check if user is an admin or manager
 */
export async function isAdminOrManager(userIdOrAuthId: string, email?: string): Promise<boolean> {
  const roleCode = await getUserRoleCode(userIdOrAuthId, email);
  return roleCode === 'admin' || roleCode === 'lab_manager' || roleCode === 'manager';
}
