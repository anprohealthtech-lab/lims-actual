import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { supabase } from '../../utils/supabase';
import { useAuth } from '../../contexts/AuthContext';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  role_id?: string;
  department?: string;
  department_id?: string;
  phone?: string;
  contact_number?: string;
  gender?: string;
  is_phlebotomist?: boolean;
  clinic_keywords?: string;
  lab_id?: string;
  status?: string;
}

interface Role {
  id: string;
  role_name: string;
  role_code: string;
  description?: string;
}

interface Department {
  id: string;
  name: string;
  code: string;
}

interface EditUserModalProps {
  user: User;
  onClose: () => void;
  onSuccess?: () => void;
  isAdmin?: boolean;
}

const EditUserModal: React.FC<EditUserModalProps> = ({ user, onClose, onSuccess, isAdmin = false }) => {
  const { user: authUser } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableRoles, setAvailableRoles] = useState<Role[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [rolePermissions, setRolePermissions] = useState<any[]>([]);
  
  const [formData, setFormData] = useState({
    name: user.name || '',
    role_id: user.role_id || '',
    contact_number: user.contact_number || user.phone || '',
    gender: user.gender || '',
    department_id: user.department_id || '',
    is_phlebotomist: user.is_phlebotomist || false,
    clinic_keywords: user.clinic_keywords || '',
  });

  useEffect(() => {
    loadRolesAndDepartments();
  }, []);

  useEffect(() => {
    if (formData.role_id) {
      loadRolePermissions(formData.role_id);
    }
  }, [formData.role_id]);

  const loadRolePermissions = async (roleId: string) => {
    try {
      const { data, error } = await supabase
        .from('role_permissions')
        .select('permissions(id, permission_code, permission_name, description, category)')
        .eq('role_id', roleId);

      if (error) throw error;
      setRolePermissions(data?.map((rp: any) => rp.permissions).filter(Boolean) || []);
    } catch (err) {
      console.error('Error loading role permissions:', err);
    }
  };

  const loadRolesAndDepartments = async () => {
    try {
      // Load roles
      const { data: rolesData, error: rolesError } = await supabase
        .from('user_roles')
        .select('*')
        .eq('is_active', true)
        .order('role_name');

      if (rolesError) throw rolesError;
      setAvailableRoles(rolesData || []);

      // Load departments
      const { data: deptData, error: deptError } = await supabase
        .from('departments')
        .select('*')
        .eq('is_active', true)
        .order('name');

      if (deptError) throw deptError;
      setDepartments(deptData || []);
    } catch (err: any) {
      console.error('Error loading roles/departments:', err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name.trim()) {
      setError('Name is required');
      return;
    }

    if (!formData.role_id) {
      setError('Role is required');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const updateData: any = {
        name: formData.name,
        role_id: formData.role_id,
        contact_number: formData.contact_number || null,
        gender: formData.gender || null,
        department_id: formData.department_id || null,
        is_phlebotomist: formData.is_phlebotomist,
        clinic_keywords: formData.clinic_keywords || null,
        updated_at: new Date().toISOString(),
      };

      const { error: updateError } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', user.id);

      if (updateError) throw updateError;

      onSuccess?.();
      onClose();
    } catch (err: any) {
      console.error('Error updating user:', err);
      setError(err.message || 'Failed to update user');
    } finally {
      setLoading(false);
    }
  };

  const selectedRole = availableRoles.find(r => r.id === formData.role_id);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto border-4 border-green-500">
        <div className="flex items-center justify-between p-6 border-b border-gray-200 bg-green-50">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              ✏️ Edit User Profile - {user.name}
            </h2>
            <p className="text-sm text-green-600 mt-1">Update existing user details (no auth changes)</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-500">
            <X className="h-6 w-6" />
          </button>
        </div>

        {error && (
          <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Basic Information */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-4">Basic Information</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email (Read Only)
                </label>
                <input
                  type="email"
                  value={user.email}
                  disabled
                  className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-100 cursor-not-allowed"
                />
                <p className="text-xs text-gray-500 mt-1">Email cannot be changed</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Contact Number
                </label>
                <input
                  type="tel"
                  value={formData.contact_number}
                  onChange={(e) => setFormData(prev => ({ ...prev, contact_number: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Gender
                </label>
                <select
                  value={formData.gender}
                  onChange={(e) => setFormData(prev => ({ ...prev, gender: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select Gender</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>
          </div>

          {/* Role & Department */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-4">Role & Department</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Role *
                </label>
                <select
                  required
                  value={formData.role_id}
                  onChange={(e) => setFormData(prev => ({ ...prev, role_id: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select Role</option>
                  {availableRoles.map(role => (
                    <option key={role.id} value={role.id}>
                      {role.role_name}
                    </option>
                  ))}
                </select>
                {selectedRole && (
                  <p className="text-xs text-gray-500 mt-1">{selectedRole.description}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Department
                </label>
                <select
                  value={formData.department_id}
                  onChange={(e) => setFormData(prev => ({ ...prev, department_id: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select Department</option>
                  {departments.map(dept => (
                    <option key={dept.id} value={dept.id}>
                      {dept.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Role Permissions Display */}
            {rolePermissions.length > 0 && (
              <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <h4 className="text-sm font-semibold text-blue-900 mb-3">
                  🔒 Permissions for {selectedRole?.role_name} ({rolePermissions.length} total)
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {rolePermissions.map((perm: any) => (
                    <div key={perm.id} className="bg-white p-3 rounded border border-blue-100">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-900">{perm.permission_name}</p>
                          {perm.description && (
                            <p className="text-xs text-gray-500 mt-1">{perm.description}</p>
                          )}
                          {perm.category && (
                            <span className="inline-block mt-2 px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded">
                              {perm.category}
                            </span>
                          )}
                        </div>
                        <span className="ml-2 text-green-600 text-lg">✓</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Special Roles */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-4">Special Roles & Keywords</h3>
            <div className="space-y-4">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={formData.is_phlebotomist}
                  onChange={(e) => setFormData(prev => ({ ...prev, is_phlebotomist: e.target.checked }))}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <span className="ml-2 text-sm text-gray-700">
                  Mark as Phlebotomist (for sample collection)
                </span>
              </label>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Clinic Keywords
                </label>
                <textarea
                  value={formData.clinic_keywords}
                  onChange={(e) => setFormData(prev => ({ ...prev, clinic_keywords: e.target.value }))}
                  rows={3}
                  placeholder="Keywords for clinic/location matching (comma separated)"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Used for auto-assignment of orders from specific clinics
                </p>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end space-x-4 pt-6 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
            >
              {loading ? 'Updating...' : 'Update User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditUserModal;
