import React, { useState, useEffect } from 'react';
import { X, User, Mail, Phone, Lock, Eye, EyeOff, Building, MapPin, AlertCircle } from 'lucide-react';
import { supabase, database } from '../../utils/supabase';

interface AddUserModalProps {
  onClose: () => void;
  onSuccess?: () => void;
  editUser?: any; // For edit mode
}

interface Role {
  id: string;
  role_name: string;
  role_code: string;
  description: string;
}

interface Permission {
  id: string;
  permission_name: string;
  permission_code: string;
  description: string;
  category: string;
}

interface Location {
  id: string;
  name: string;
  code: string;
}

const AddUserModal: React.FC<AddUserModalProps> = ({ onClose, onSuccess, editUser }) => {
  const [activeTab, setActiveTab] = useState<'basic' | 'role' | 'permissions'>('basic');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    name: editUser?.name || '',
    email: editUser?.email || '',
    contact_number: editUser?.contact_number || '',
    gender: editUser?.gender || 'Male',
    username: editUser?.username || '',
    password: '',
    confirmPassword: '',
    role_id: editUser?.role_id || '',
    location_ids: editUser?.location_ids || [],
    is_phlebotomist: editUser?.is_phlebotomist || false,
    extra_permissions: editUser?.permissions || [], // Additional permissions beyond role
  });

  // Data state
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [groupedPermissions, setGroupedPermissions] = useState<Record<string, Permission[]>>({});
  const [locations, setLocations] = useState<Location[]>([]);
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [rolePermissions, setRolePermissions] = useState<string[]>([]);

  // Load roles, permissions, and locations
  useEffect(() => {
    loadData();
  }, []);

  // Load permissions when role changes
  useEffect(() => {
    if (formData.role_id) {
      loadRolePermissions(formData.role_id);
    }
  }, [formData.role_id]);

  const loadData = async () => {
    try {
      const labId = await database.getCurrentUserLabId();
      if (!labId) {
        setError('No lab context found');
        return;
      }

      // Load roles
      const { data: rolesData, error: rolesError } = await supabase
        .from('user_roles')
        .select('*')
        .eq('is_active', true)
        .order('role_name');

      if (rolesError) throw rolesError;
      setRoles(rolesData || []);

      // Load permissions
      const { data: permsData, error: permsError } = await supabase
        .from('permissions')
        .select('*')
        .eq('is_active', true)
        .order('category', { ascending: true })
        .order('permission_name', { ascending: true });

      if (permsError) throw permsError;
      setPermissions(permsData || []);

      // Group permissions by category
      const grouped = (permsData || []).reduce((acc, perm) => {
        const category = perm.category || 'Other';
        if (!acc[category]) acc[category] = [];
        acc[category].push(perm);
        return acc;
      }, {} as Record<string, Permission[]>);
      setGroupedPermissions(grouped);

      // Load locations
      const { data: locationsData } = await database.locations.getAll();
      setLocations(locationsData || []);
    } catch (err: any) {
      console.error('Error loading data:', err);
      setError(err.message || 'Failed to load data');
    }
  };

  const loadRolePermissions = async (roleId: string) => {
    try {
      const { data, error } = await supabase
        .from('role_permissions')
        .select('permission_id, permissions(permission_code)')
        .eq('role_id', roleId);

      if (error) throw error;

      const permCodes = data?.map((rp: any) => rp.permissions?.permission_code).filter(Boolean) || [];
      setRolePermissions(permCodes);

      // Find and set selected role
      const role = roles.find(r => r.id === roleId);
      setSelectedRole(role || null);
    } catch (err: any) {
      console.error('Error loading role permissions:', err);
    }
  };

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setError('');
  };

  const toggleLocation = (locationId: string) => {
    setFormData(prev => ({
      ...prev,
      location_ids: prev.location_ids.includes(locationId)
        ? prev.location_ids.filter(id => id !== locationId)
        : [...prev.location_ids, locationId]
    }));
  };

  // Toggle extra permissions (beyond role permissions)
  const toggleExtraPermission = (permissionCode: string) => {
    // Only allow toggling if it's not already granted by role
    if (rolePermissions.includes(permissionCode)) return;
    
    setFormData(prev => ({
      ...prev,
      extra_permissions: prev.extra_permissions.includes(permissionCode)
        ? prev.extra_permissions.filter((p: string) => p !== permissionCode)
        : [...prev.extra_permissions, permissionCode]
    }));
  };

  const validateForm = (): string | null => {
    if (!formData.name.trim()) return 'Name is required';
    if (!formData.email.trim()) return 'Email is required';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) return 'Invalid email format';
    if (!editUser && !formData.password) return 'Password is required';
    if (!editUser && formData.password !== formData.confirmPassword) return 'Passwords do not match';
    if (!editUser && formData.password.length < 6) return 'Password must be at least 6 characters';
    if (!formData.role_id) return 'Please select a role';
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const labId = await database.getCurrentUserLabId();
      if (!labId) throw new Error('No lab context found');

      if (editUser) {
        // Update existing user
        const { error: updateError } = await supabase
          .from('users')
          .update({
            name: formData.name,
            contact_number: formData.contact_number,
            gender: formData.gender,
            role_id: formData.role_id,
            is_phlebotomist: formData.is_phlebotomist,
            permissions: formData.extra_permissions, // Save extra permissions
            updated_at: new Date().toISOString()
          })
          .eq('id', editUser.id);

        if (updateError) throw updateError;

        // If connect_whatsapp permission was added, sync user to WhatsApp backend
        if (formData.extra_permissions.includes('connect_whatsapp') && 
            !editUser?.permissions?.includes('connect_whatsapp')) {
          try {
            await supabase.functions.invoke('sync-user-to-whatsapp', {
              body: { userId: editUser.id }
            });
            console.log('User synced to WhatsApp backend');
          } catch (syncError) {
            console.warn('WhatsApp sync failed:', syncError);
            // Don't fail the save - sync can be retried later
          }
        }

        // Update center assignments
        await supabase.from('user_centers').delete().eq('user_id', editUser.id);
        if (formData.location_ids.length > 0) {
          await supabase.from('user_centers').insert(
            formData.location_ids.map((locId, idx) => ({
              user_id: editUser.id,
              location_id: locId,
              is_primary: idx === 0
            }))
          );
        }
      } else {
        // Create Supabase auth user
        const { data: authData, error: authError } = await supabase.auth.signUp({
          email: formData.email,
          password: formData.password,
          options: {
            data: {
              full_name: formData.name,
              role: selectedRole?.role_name,
              lab_id: labId
            }
          }
        });

        if (authError) throw authError;
        if (!authData.user) throw new Error('Failed to create auth user');

        // Create public.users record
        const { data: newUser, error: userError } = await supabase
          .from('users')
          .insert([{
            name: formData.name,
            email: formData.email,
            contact_number: formData.contact_number,
            gender: formData.gender,
            username: formData.username || null,
            role_id: formData.role_id,
            lab_id: labId,
            auth_user_id: authData.user.id,
            is_phlebotomist: formData.is_phlebotomist,
            permissions: formData.extra_permissions, // Save extra permissions
            status: 'Active',
            join_date: new Date().toISOString().split('T')[0],
          }])
          .select()
          .single();

        if (userError) throw userError;

        // If connect_whatsapp permission was granted, sync user to WhatsApp backend
        if (formData.extra_permissions.includes('connect_whatsapp')) {
          try {
            await supabase.functions.invoke('sync-user-to-whatsapp', {
              body: { userId: newUser.id }
            });
            console.log('New user synced to WhatsApp backend');
          } catch (syncError) {
            console.warn('WhatsApp sync failed:', syncError);
          }
        }

        // Create center assignments
        if (formData.location_ids.length > 0) {
          await supabase.from('user_centers').insert(
            formData.location_ids.map((locId, idx) => ({
              user_id: newUser.id,
              location_id: locId,
              is_primary: idx === 0
            }))
          );
        }
      }

      onSuccess?.();
      onClose();
    } catch (err: any) {
      console.error('Error saving user:', err);
      setError(err.message || 'Failed to save user');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">
            {editUser ? 'Edit User' : 'Add New User'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 px-6">
          <button
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'basic'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setActiveTab('basic')}
          >
            Basic Details
          </button>
          <button
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'role'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setActiveTab('role')}
          >
            Role & Centers
          </button>
          <button
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'permissions'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setActiveTab('permissions')}
          >
            Permissions
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="p-6 space-y-6">
            {/* Error Message */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-md p-3 flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-red-600" />
                <span className="text-sm text-red-700">{error}</span>
              </div>
            )}

            {/* Basic Details Tab */}
            {activeTab === 'basic' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Name <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => handleInputChange('name', e.target.value)}
                        className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Enter full name"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Email <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="email"
                        value={formData.email}
                        onChange={(e) => handleInputChange('email', e.target.value)}
                        className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="user@example.com"
                        disabled={!!editUser}
                        required
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Contact Number
                    </label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="tel"
                        value={formData.contact_number}
                        onChange={(e) => handleInputChange('contact_number', e.target.value)}
                        className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="+91 98765 43210"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Gender
                    </label>
                    <select
                      value={formData.gender}
                      onChange={(e) => handleInputChange('gender', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                </div>

                {!editUser && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Password <span className="text-red-500">*</span>
                        </label>
                        <div className="relative">
                          <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                          <input
                            type={showPassword ? 'text' : 'password'}
                            value={formData.password}
                            onChange={(e) => handleInputChange('password', e.target.value)}
                            className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="Min. 6 characters"
                            required
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                          >
                            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Confirm Password <span className="text-red-500">*</span>
                        </label>
                        <div className="relative">
                          <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                          <input
                            type={showPassword ? 'text' : 'password'}
                            value={formData.confirmPassword}
                            onChange={(e) => handleInputChange('confirmPassword', e.target.value)}
                            className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="Re-enter password"
                            required
                          />
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Role & Centers Tab */}
            {activeTab === 'role' && (
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Select Role <span className="text-red-500">*</span>
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    {roles.map(role => (
                      <label
                        key={role.id}
                        className={`flex items-start p-4 border-2 rounded-lg cursor-pointer transition-colors ${
                          formData.role_id === role.id
                            ? 'border-blue-600 bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <input
                          type="radio"
                          name="role"
                          value={role.id}
                          checked={formData.role_id === role.id}
                          onChange={() => handleInputChange('role_id', role.id)}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 mt-1"
                        />
                        <div className="ml-3">
                          <div className="text-sm font-medium text-gray-900">{role.role_name}</div>
                          <div className="text-xs text-gray-500 mt-1">{role.description}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                    <Building className="w-4 h-4" />
                    Assign Centers
                  </label>
                  <div className="border border-gray-200 rounded-lg p-4 max-h-60 overflow-y-auto">
                    {locations.length === 0 ? (
                      <p className="text-sm text-gray-500">No centers available</p>
                    ) : (
                      <div className="space-y-2">
                        {locations.map(location => (
                          <label
                            key={location.id}
                            className="flex items-center p-2 hover:bg-gray-50 rounded cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={formData.location_ids.includes(location.id)}
                              onChange={() => toggleLocation(location.id)}
                              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                            />
                            <div className="ml-3">
                              <div className="text-sm font-medium text-gray-900">{location.name}</div>
                              <div className="text-xs text-gray-500">{location.code}</div>
                            </div>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label className="flex items-center p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={formData.is_phlebotomist}
                      onChange={(e) => handleInputChange('is_phlebotomist', e.target.checked)}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <div className="ml-3">
                      <div className="text-sm font-medium text-gray-900">Phlebotomist</div>
                      <div className="text-xs text-gray-500">Mark this user as a phlebotomist for sample collection</div>
                    </div>
                  </label>
                </div>
              </div>
            )}

            {/* Permissions Tab */}
            {activeTab === 'permissions' && (
              <div className="space-y-4">
                {selectedRole ? (
                  <>
                    <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
                      <div className="text-sm font-medium text-blue-900">
                        {selectedRole.role_name} Permissions
                      </div>
                      <div className="text-xs text-blue-700 mt-1">
                        Checked permissions are granted. Green = from role, Blue = extra permission you can toggle.
                      </div>
                    </div>

                    {Object.entries(groupedPermissions).map(([category, perms]) => (
                      <div key={category} className="border border-gray-200 rounded-lg p-4">
                        <h3 className="text-sm font-semibold text-gray-900 mb-3">{category}</h3>
                        <div className="grid grid-cols-2 gap-2">
                          {perms.map(perm => {
                            const fromRole = rolePermissions.includes(perm.permission_code);
                            const fromExtra = formData.extra_permissions.includes(perm.permission_code);
                            const hasPermission = fromRole || fromExtra;
                            const canToggle = !fromRole; // Can only toggle if not from role
                            
                            return (
                              <label
                                key={perm.id}
                                className={`flex items-start p-2 rounded cursor-pointer transition-colors ${
                                  fromRole 
                                    ? 'bg-green-50 cursor-not-allowed' 
                                    : fromExtra 
                                      ? 'bg-blue-50 hover:bg-blue-100' 
                                      : 'bg-gray-50 hover:bg-gray-100'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={hasPermission}
                                  disabled={!canToggle}
                                  onChange={() => canToggle && toggleExtraPermission(perm.permission_code)}
                                  className={`h-4 w-4 border-gray-300 rounded mt-0.5 ${
                                    fromRole 
                                      ? 'text-green-600' 
                                      : 'text-blue-600 focus:ring-blue-500'
                                  }`}
                                />
                                <div className="ml-2 flex-1">
                                  <div className="flex items-center gap-1">
                                    <span className="text-xs font-medium text-gray-900">{perm.permission_name}</span>
                                    {fromRole && (
                                      <span className="text-[10px] bg-green-200 text-green-800 px-1 rounded">Role</span>
                                    )}
                                    {fromExtra && (
                                      <span className="text-[10px] bg-blue-200 text-blue-800 px-1 rounded">Extra</span>
                                    )}
                                  </div>
                                  <div className="text-xs text-gray-500">{perm.description}</div>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </>
                ) : (
                  <div className="text-center text-gray-500 py-8">
                    <Building className="w-12 h-12 mx-auto mb-3 text-gray-400" />
                    <p className="text-sm">Please select a role first to view permissions</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Saving...' : editUser ? 'Update User' : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddUserModal;
