import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getUserPermissions } from '../utils/permissions';

export const usePermissions = () => {
  const { user } = useAuth();
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const loadPermissions = async () => {
      if (!user?.id) {
        if (active) {
          setPermissions([]);
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      const nextPermissions = await getUserPermissions(user.id, user.email);

      if (active) {
        setPermissions(nextPermissions);
        setLoading(false);
      }
    };

    loadPermissions();

    return () => {
      active = false;
    };
  }, [user?.email, user?.id]);

  const permissionSet = useMemo(() => new Set(permissions), [permissions]);

  const hasPermission = (permissionCode: string) => {
    const candidates: Record<string, string[]> = {
      'whatsapp.connect': ['whatsapp.connect', 'connect_whatsapp'],
      'whatsapp.send': ['whatsapp.send', 'connect_whatsapp'],
      'users.view': ['users.view', 'view_users'],
      'users.create': ['users.create', 'create_user'],
      'users.edit': ['users.edit', 'edit_user'],
      'users.deactivate': ['users.deactivate', 'delete_user'],
      'settings.view': ['settings.view', 'lab_settings'],
      'settings.edit_lab': ['settings.edit_lab', 'lab_settings'],
      'settings.manage_report_sections': ['settings.manage_report_sections', 'edit_report_templates'],
      'results.view': ['results.view', 'view_results'],
      'results.enter_general': ['results.enter_general', 'enter_results'],
      'results.enter_radiology': ['results.enter_radiology', 'enter_results'],
      'results.verify': ['results.verify', 'approve_results'],
      'results.verify_radiology': ['results.verify_radiology', 'approve_results'],
      'results.verify_section_only': ['results.verify_section_only', 'approve_results'],
      'results.unapprove': ['results.unapprove', 'unapprove_results'],
      'sections.edit_technician': ['sections.edit_technician'],
      'sections.edit_doctor': ['sections.edit_doctor'],
      'sections.edit_radiology': ['sections.edit_radiology'],
    };

    const options = [...new Set([permissionCode, ...(candidates[permissionCode] || [])])];
    return options.some((candidate) => permissionSet.has(candidate));
  };

  const hasAnyPermission = (permissionCodes: string[]) => permissionCodes.some(hasPermission);
  const hasAllPermissions = (permissionCodes: string[]) => permissionCodes.every(hasPermission);

  return {
    loading,
    permissions,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
  };
};
