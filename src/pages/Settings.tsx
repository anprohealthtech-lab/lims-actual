import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { database, supabase } from '../utils/supabase';
import EditUserModal from '../components/Users/EditUserModal';
import { 
  Users, 
  Shield, 
  BarChart3, 
  Settings as SettingsIcon, 
  Plus, 
  Edit, 
  Trash2, 
  Eye, 
  EyeOff,
  Search,
  Filter,
  Download,
  Upload,
  Bell,
  Lock,
  Key,
  UserCheck,
  UserX,
  Clock,
  Activity,
  Database,
  Server,
  Wifi,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Calendar,
  Mail,
  Phone,
  MapPin,
  Building,
  Globe,
  Palette,
  Monitor,
  Smartphone,
  Tablet
} from 'lucide-react';

interface User {
  id: string;
  name: string;
  email: string;
  role: 'Admin' | 'Lab Manager' | 'Technician' | 'Receptionist' | 'Doctor';
  department: string;
  status: 'Active' | 'Inactive' | 'Suspended';
  lastLogin: string;
  permissions: string[];
  phone: string;
  joinDate: string;
  avatar?: string;
}

interface Permission {
  id: string;
  name: string;
  description: string;
  category: string;
  isDefault: boolean;
}

interface UsageStats {
  totalUsers: number;
  activeUsers: number;
  totalTests: number;
  totalPatients: number;
  storageUsed: number;
  storageLimit: number;
  apiCalls: number;
  apiLimit: number;
}

// Define UserForm component outside of Settings
const UserFormComponent: React.FC<{ 
  onClose: () => void; 
  user?: User; 
  permissions: Permission[],
  availableRoles: any[],
  labId?: string,
  onSave?: () => void
}> = ({ onClose, user, permissions, availableRoles, labId, onSave }) => {
  // Initialize roleId by finding matching role from availableRoles
  const initialRoleId = user ? availableRoles.find(r => r.role_name === user.role)?.id || '' : '';
  
  const [formData, setFormData] = useState({
    name: user?.name || '',
    email: user?.email || '',
    roleId: initialRoleId,
    department: user?.department || '',
    phone: user?.phone || '',
    permissions: user?.permissions || [],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!labId) {
      console.error('labId is missing in UserFormComponent', { labId, user });
      setError('Lab context not found. Please refresh the page and try again.');
      return;
    }

    try {
      setSaving(true);
      setError(null);

      // Find role ID from role selection
      const selectedRole = availableRoles.find(r => r.id === formData.roleId);
      
      if (!selectedRole) {
        setError('Please select a valid role');
        return;
      }

      if (user) {
        // Update existing user
        const { error: updateError } = await supabase
          .from('users')
          .update({
            name: formData.name,
            email: formData.email,
            role_id: selectedRole.id,
            department: formData.department,
            phone: formData.phone,
            updated_at: new Date().toISOString(),
          })
          .eq('id', user.id);

        if (updateError) throw updateError;
      } else {
        // Create new user (note: this should ideally be done through Auth system)
        console.log('Creating user with lab_id:', labId);
        const { error: insertError } = await supabase
          .from('users')
          .insert({
            name: formData.name,
            email: formData.email,
            role_id: selectedRole.id,
            department: formData.department,
            phone: formData.phone,
            lab_id: labId,
            status: 'Active',
            join_date: new Date().toISOString(),
            created_at: new Date().toISOString(),
          });

        if (insertError) throw insertError;
      }

      onSave?.();
      onClose();
    } catch (err) {
      console.error('Error creating user:', err);
      setError(err instanceof Error ? err.message : 'Failed to save user');
    } finally {
      setSaving(false);
    }
  };

  const handlePermissionToggle = (permissionId: string) => {
    setFormData(prev => ({
      ...prev,
      permissions: prev.permissions.includes(permissionId)
        ? prev.permissions.filter(id => id !== permissionId)
        : [...prev.permissions, permissionId]
    }));
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">
            {user ? 'Edit User' : 'Add New User'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-500">
            <XCircle className="h-6 w-6" />
          </button>
        </div>

        {error && (
          <div className="p-4 bg-red-50 border-b border-red-200">
            <div className="text-sm text-red-700">{error}</div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
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
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email Address *
              </label>
              <input
                type="email"
                required
                value={formData.email}
                onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Role *
              </label>
              <select
                required
                value={formData.roleId}
                onChange={(e) => setFormData(prev => ({ ...prev, roleId: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select a role</option>
                {availableRoles.map(role => (
                  <option key={role.id} value={role.id}>{role.role_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Department
              </label>
              <input
                type="text"
                value={formData.department}
                onChange={(e) => setFormData(prev => ({ ...prev, department: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Phone Number
              </label>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-4">Permissions</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {permissions.map(permission => (
                <label key={permission.id} className="flex items-start p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.permissions.includes(permission.id)}
                    onChange={() => handlePermissionToggle(permission.id)}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded mt-1"
                  />
                  <div className="ml-3">
                    <div className="text-sm font-medium text-gray-900">{permission.name}</div>
                    <div className="text-xs text-gray-500">{permission.description}</div>
                    <div className="text-xs text-blue-600">{permission.category}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

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
              disabled={saving}
              className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
            >
              {saving ? 'Saving...' : user ? 'Update User' : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const Settings: React.FC = () => {
  const { user: authUser } = useAuth();
  const [activeTab, setActiveTab] = useState<'team' | 'permissions' | 'usage' | 'system' | 'notifications' | 'appearance'>('team');
  const [showUserForm, setShowUserForm] = useState(false);
  const [showEditUserModal, setShowEditUserModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRole, setSelectedRole] = useState('All');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [labId, setLabId] = useState<string | null>(null);

  // Real database state
  const [users, setUsers] = useState<User[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [availableRoles, setAvailableRoles] = useState<any[]>([]);
  const [usageStats, setUsageStats] = useState<UsageStats>({
    totalUsers: 0,
    activeUsers: 0,
    totalTests: 0,
    totalPatients: 0,
    storageUsed: 0,
    storageLimit: 10,
    apiCalls: 0,
    apiLimit: 100000,
  });

  // Load data from database
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);

        if (!authUser?.id) {
          setError('User not authenticated');
          console.error('Auth user not found');
          return;
        }

        // Get lab_id using the centralized method
        const currentLabId = await database.getCurrentUserLabId();
        console.log('getCurrentUserLabId result:', currentLabId, 'for user:', authUser.email);
        
        if (!currentLabId) {
          setError('Lab context not found. User may not be assigned to any lab.');
          console.error('No lab_id found for user:', authUser.email);
          return;
        }
        
        // Store lab_id in state for use in modal
        setLabId(currentLabId);
        console.log('Lab ID set to state:', currentLabId);

        // Load users for this lab
        const { data: labUsers, error: usersError } = await supabase
          .from('users')
          .select(`
            id,
            name,
            email,
            phone,
            department,
            status,
            last_login,
            join_date,
            user_roles(role_name, role_code)
          `)
          .eq('lab_id', currentLabId)
          .order('name');

        if (usersError) throw usersError;

        // Transform users data
        const transformedUsers: User[] = (labUsers || []).map((u: any) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.user_roles?.role_name || 'Technician',
          department: u.department || '',
          status: u.status === 'Active' ? 'Active' : u.status === 'Inactive' ? 'Inactive' : 'Suspended',
          lastLogin: u.last_login || 'Never',
          permissions: [], // Will be loaded separately
          phone: u.phone || '',
          joinDate: u.join_date || new Date().toISOString(),
        }));

        setUsers(transformedUsers);

        // Load user roles
        const { data: rolesData, error: rolesError } = await supabase
          .from('user_roles')
          .select('id, role_name, role_code, is_active')
          .eq('is_active', true)
          .order('role_name');

        if (rolesError) throw rolesError;
        setAvailableRoles(rolesData || []);

        // Load permissions
        const { data: permsData, error: permsError } = await supabase
          .from('permissions')
          .select('id, permission_name, description, category, is_active')
          .eq('is_active', true)
          .order('category, permission_name');

        if (permsError) throw permsError;

        const transformedPermissions: Permission[] = (permsData || []).map((p: any) => ({
          id: p.id,
          name: p.permission_name,
          description: p.description || '',
          category: p.category || 'General',
          isDefault: false,
        }));

        setPermissions(transformedPermissions);

        // Load usage stats
        const { count: totalUsersCount } = await supabase
          .from('users')
          .select('id', { count: 'exact' })
          .eq('lab_id', currentLabId);

        const { count: activeUsersCount } = await supabase
          .from('users')
          .select('id', { count: 'exact' })
          .eq('lab_id', currentLabId)
          .eq('status', 'Active');

        const { count: totalTestsCount } = await supabase
          .from('order_tests')
          .select('id', { count: 'exact' })
          .eq('lab_id', currentLabId);

        const { count: totalPatientsCount } = await supabase
          .from('patients')
          .select('id', { count: 'exact' })
          .eq('lab_id', currentLabId);

        setUsageStats(prev => ({
          ...prev,
          totalUsers: totalUsersCount || 0,
          activeUsers: activeUsersCount || 0,
          totalTests: totalTestsCount || 0,
          totalPatients: totalPatientsCount || 0,
        }));
      } catch (err) {
        console.error('Error loading settings data:', err);
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [authUser?.id]);

  const tabs = [
    { id: 'team', name: 'Team Management', icon: Users },
    { id: 'permissions', name: 'Permissions', icon: Shield },
    { id: 'usage', name: 'Usage & Analytics', icon: BarChart3 },
    { id: 'system', name: 'System Settings', icon: SettingsIcon },
    { id: 'notifications', name: 'Notifications', icon: Bell },
    { id: 'appearance', name: 'Appearance', icon: Palette },
  ];

  const roles = availableRoles.length > 0 
    ? ['All', ...availableRoles.map(r => r.role_name)]
    : ['All', 'Admin', 'Lab Manager', 'Technician', 'Receptionist', 'Doctor'];

  const filteredUsers = users.filter(user => {
    const matchesSearch = user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         user.email.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesRole = selectedRole === 'All' || user.role === selectedRole;
    return matchesSearch && matchesRole;
  });

  // Delete user (soft delete)
  const handleDeleteUser = async (userId: string) => {
    if (!window.confirm('Are you sure you want to delete this user?')) return;

    try {
      const { error } = await supabase
        .from('users')
        .update({ status: 'Inactive', updated_at: new Date().toISOString() })
        .eq('id', userId);

      if (error) throw error;

      setUsers(users.filter(u => u.id !== userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete user');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Active': return 'text-green-600 bg-green-100';
      case 'Inactive': return 'text-gray-600 bg-gray-100';
      case 'Suspended': return 'text-red-600 bg-red-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'Admin': return 'text-purple-600 bg-purple-100';
      case 'Lab Manager': return 'text-blue-600 bg-blue-100';
      case 'Technician': return 'text-green-600 bg-green-100';
      case 'Receptionist': return 'text-orange-600 bg-orange-100';
      case 'Doctor': return 'text-red-600 bg-red-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
          <p className="text-gray-600 mt-1">Manage your LIMS system configuration and team</p>
        </div>
        <div className="flex items-center space-x-3">
          <button className="flex items-center px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
            <Download className="h-4 w-4 mr-2" />
            Export Settings
          </button>
          <button className="flex items-center px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
            <Upload className="h-4 w-4 mr-2" />
            Import Settings
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-1">
        <div className="flex space-x-1 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center px-4 py-3 rounded-md text-sm font-medium transition-all whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              <tab.icon className="h-4 w-4 mr-2" />
              {tab.name}
            </button>
          ))}
        </div>
      </div>

      {/* Team Management Tab */}
      {activeTab === 'team' && (
        <div className="space-y-6">
          {loading && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
              <div className="text-gray-500">Loading team data...</div>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="text-sm text-red-700">{error}</div>
            </div>
          )}
          {/* Team Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center">
                <div className="bg-blue-100 p-3 rounded-lg">
                  <Users className="h-6 w-6 text-blue-600" />
                </div>
                <div className="ml-4">
                  <div className="text-2xl font-bold text-gray-900">{usageStats.totalUsers}</div>
                  <div className="text-sm text-gray-600">Total Users</div>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center">
                <div className="bg-green-100 p-3 rounded-lg">
                  <UserCheck className="h-6 w-6 text-green-600" />
                </div>
                <div className="ml-4">
                  <div className="text-2xl font-bold text-gray-900">{usageStats.activeUsers}</div>
                  <div className="text-sm text-gray-600">Active Users</div>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center">
                <div className="bg-orange-100 p-3 rounded-lg">
                  <Clock className="h-6 w-6 text-orange-600" />
                </div>
                <div className="ml-4">
                  <div className="text-2xl font-bold text-gray-900">
                    {users.filter(u => new Date(u.lastLogin) > new Date(Date.now() - 24*60*60*1000)).length}
                  </div>
                  <div className="text-sm text-gray-600">Online Today</div>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center">
                <div className="bg-purple-100 p-3 rounded-lg">
                  <Shield className="h-6 w-6 text-purple-600" />
                </div>
                <div className="ml-4">
                  <div className="text-2xl font-bold text-gray-900">
                    {users.filter(u => u.role === 'Admin').length}
                  </div>
                  <div className="text-sm text-gray-600">Administrators</div>
                </div>
              </div>
            </div>
          </div>

          {/* Search and Filter */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search users by name or email..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 pr-4 py-2 w-full border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <select
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {roles.map(role => (
                  <option key={role} value={role}>{role}</option>
                ))}
              </select>
              <button
                onClick={() => {
                  if (!labId) {
                    alert('Lab context is still loading. Please wait...');
                    return;
                  }
                  setShowUserForm(true);
                }}
                disabled={!labId}
                className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add User
              </button>
            </div>

            {/* Debug: Test Edit Modal */}
            <div className="flex items-center space-x-4 mb-4">
              <button
                onClick={() => {
                  if (users.length > 0) {
                    setSelectedUser(users[0]);
                    setShowEditUserModal(true);
                  }
                }}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
              >
                🔧 Test Edit Current User
              </button>
              <select
                onChange={(e) => {
                  const userId = e.target.value;
                  const user = users.find(u => u.id === userId);
                  if (user) {
                    setSelectedUser(user);
                    setShowEditUserModal(true);
                  }
                }}
                className="px-4 py-2 border border-gray-300 rounded-md"
              >
                <option value="">Select user to edit...</option>
                {users.map(user => (
                  <option key={user.id} value={user.id}>
                    {user.name} ({user.email})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Users Table */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Team Members ({filteredUsers.length})</h3>
            </div>
            
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Department</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Login</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredUsers.map((user) => (
                    <tr key={user.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="h-10 w-10 bg-blue-500 rounded-full flex items-center justify-center">
                            <span className="text-white font-medium">
                              {user.name.split(' ').map(n => n[0]).join('')}
                            </span>
                          </div>
                          <div className="ml-4">
                            <div className="text-sm font-medium text-gray-900">{user.name}</div>
                            <div className="text-sm text-gray-500">{user.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getRoleColor(user.role)}`}>
                          {user.role}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {user.department}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(user.status)}`}>
                          {user.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {new Date(user.lastLogin).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                        <button
                          onClick={() => setSelectedUser(user)}
                          className="text-blue-600 hover:text-blue-900 p-1 rounded"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => { setSelectedUser(user); setShowEditUserModal(true); }}
                          className="text-gray-600 hover:text-gray-900 p-1 rounded"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteUser(user.id)}
                          className="text-red-600 hover:text-red-900 p-1 rounded"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Permissions Tab */}
      {activeTab === 'permissions' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Permission Management</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {Object.entries(
                permissions.reduce((acc, permission) => {
                  if (!acc[permission.category]) acc[permission.category] = [];
                  acc[permission.category].push(permission);
                  return acc;
                }, {} as Record<string, Permission[]>)
              ).map(([category, categoryPermissions]) => (
                <div key={category} className="border border-gray-200 rounded-lg p-4">
                  <h4 className="font-medium text-gray-900 mb-3 flex items-center">
                    <Shield className="h-4 w-4 mr-2 text-blue-600" />
                    {category}
                  </h4>
                  <div className="space-y-2">
                    {categoryPermissions.map(permission => (
                      <div key={permission.id} className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="text-sm font-medium text-gray-900">{permission.name}</div>
                          <div className="text-xs text-gray-500">{permission.description}</div>
                        </div>
                        {permission.isDefault && (
                          <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">Default</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Usage & Analytics Tab */}
      {activeTab === 'usage' && (
        <div className="space-y-6">
          {/* Usage Overview */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-2xl font-bold text-gray-900">{usageStats.totalTests.toLocaleString()}</div>
                  <div className="text-sm text-gray-600">Total Tests</div>
                </div>
                <div className="bg-blue-100 p-3 rounded-lg">
                  <Activity className="h-6 w-6 text-blue-600" />
                </div>
              </div>
            </div>
            
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-2xl font-bold text-gray-900">{usageStats.totalPatients.toLocaleString()}</div>
                  <div className="text-sm text-gray-600">Total Patients</div>
                </div>
                <div className="bg-green-100 p-3 rounded-lg">
                  <Users className="h-6 w-6 text-green-600" />
                </div>
              </div>
            </div>
            
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-2xl font-bold text-gray-900">{usageStats.storageUsed}GB</div>
                  <div className="text-sm text-gray-600">Storage Used</div>
                  <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                    <div 
                      className="bg-orange-600 h-2 rounded-full" 
                      style={{ width: `${(usageStats.storageUsed / usageStats.storageLimit) * 100}%` }}
                    />
                  </div>
                </div>
                <div className="bg-orange-100 p-3 rounded-lg">
                  <Database className="h-6 w-6 text-orange-600" />
                </div>
              </div>
            </div>
            
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-2xl font-bold text-gray-900">{usageStats.apiCalls.toLocaleString()}</div>
                  <div className="text-sm text-gray-600">API Calls</div>
                  <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                    <div 
                      className="bg-purple-600 h-2 rounded-full" 
                      style={{ width: `${(usageStats.apiCalls / usageStats.apiLimit) * 100}%` }}
                    />
                  </div>
                </div>
                <div className="bg-purple-100 p-3 rounded-lg">
                  <Server className="h-6 w-6 text-purple-600" />
                </div>
              </div>
            </div>
          </div>

          {/* System Health */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">System Health</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="flex items-center justify-between p-4 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex items-center">
                  <CheckCircle className="h-5 w-5 text-green-600 mr-3" />
                  <div>
                    <div className="font-medium text-green-900">Database</div>
                    <div className="text-sm text-green-700">Operational</div>
                  </div>
                </div>
                <div className="text-green-600">99.9%</div>
              </div>
              
              <div className="flex items-center justify-between p-4 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex items-center">
                  <CheckCircle className="h-5 w-5 text-green-600 mr-3" />
                  <div>
                    <div className="font-medium text-green-900">API Services</div>
                    <div className="text-sm text-green-700">Operational</div>
                  </div>
                </div>
                <div className="text-green-600">99.8%</div>
              </div>
              
              <div className="flex items-center justify-between p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <div className="flex items-center">
                  <AlertTriangle className="h-5 w-5 text-yellow-600 mr-3" />
                  <div>
                    <div className="font-medium text-yellow-900">Backup System</div>
                    <div className="text-sm text-yellow-700">Warning</div>
                  </div>
                </div>
                <div className="text-yellow-600">95.2%</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* System Settings Tab */}
      {activeTab === 'system' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* General Settings */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">General Settings</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Lab Name</label>
                  <input
                    type="text"
                    defaultValue="MediLab Diagnostics"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Contact Email</label>
                  <input
                    type="email"
                    defaultValue="contact@medilab.com"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Time Zone</label>
                  <select className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option>Asia/Kolkata (IST)</option>
                    <option>UTC</option>
                    <option>America/New_York</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Security Settings */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Security Settings</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-gray-900">Two-Factor Authentication</div>
                    <div className="text-sm text-gray-500">Require 2FA for all users</div>
                  </div>
                  <button className="relative inline-flex h-6 w-11 items-center rounded-full bg-blue-600">
                    <span className="inline-block h-4 w-4 transform rounded-full bg-white transition translate-x-6" />
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-gray-900">Session Timeout</div>
                    <div className="text-sm text-gray-500">Auto logout after inactivity</div>
                  </div>
                  <select className="px-3 py-1 border border-gray-300 rounded-md text-sm">
                    <option>30 minutes</option>
                    <option>1 hour</option>
                    <option>2 hours</option>
                    <option>Never</option>
                  </select>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-gray-900">Password Policy</div>
                    <div className="text-sm text-gray-500">Enforce strong passwords</div>
                  </div>
                  <button className="relative inline-flex h-6 w-11 items-center rounded-full bg-blue-600">
                    <span className="inline-block h-4 w-4 transform rounded-full bg-white transition translate-x-6" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Backup & Maintenance */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Backup & Maintenance</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="text-center p-4 border border-gray-200 rounded-lg">
                <Database className="h-8 w-8 text-blue-600 mx-auto mb-2" />
                <div className="font-medium text-gray-900">Last Backup</div>
                <div className="text-sm text-gray-500">2 hours ago</div>
                <button className="mt-2 px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">
                  Backup Now
                </button>
              </div>
              <div className="text-center p-4 border border-gray-200 rounded-lg">
                <Server className="h-8 w-8 text-green-600 mx-auto mb-2" />
                <div className="font-medium text-gray-900">System Status</div>
                <div className="text-sm text-green-600">All systems operational</div>
                <button className="mt-2 px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700">
                  View Details
                </button>
              </div>
              <div className="text-center p-4 border border-gray-200 rounded-lg">
                <Wifi className="h-8 w-8 text-orange-600 mx-auto mb-2" />
                <div className="font-medium text-gray-900">Maintenance</div>
                <div className="text-sm text-gray-500">Next: Sunday 2 AM</div>
                <button className="mt-2 px-3 py-1 bg-orange-600 text-white rounded text-sm hover:bg-orange-700">
                  Schedule
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Notifications Tab */}
      {activeTab === 'notifications' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Notification Preferences</h3>
            
            <div className="space-y-6">
              {[
                { title: 'Email Notifications', desc: 'Receive notifications via email' },
                { title: 'SMS Notifications', desc: 'Receive notifications via SMS' },
                { title: 'Push Notifications', desc: 'Receive browser push notifications' },
                { title: 'Critical Alerts', desc: 'Immediate alerts for critical values' },
                { title: 'Daily Reports', desc: 'Daily summary reports' },
                { title: 'System Updates', desc: 'Notifications about system updates' },
              ].map((item, index) => (
                <div key={index} className="flex items-center justify-between py-3 border-b border-gray-200 last:border-b-0">
                  <div>
                    <div className="font-medium text-gray-900">{item.title}</div>
                    <div className="text-sm text-gray-500">{item.desc}</div>
                  </div>
                  <button className="relative inline-flex h-6 w-11 items-center rounded-full bg-blue-600">
                    <span className="inline-block h-4 w-4 transform rounded-full bg-white transition translate-x-6" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Appearance Tab */}
      {activeTab === 'appearance' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Theme Settings */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Theme Settings</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Color Theme</label>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { name: 'Blue', color: 'bg-blue-600' },
                      { name: 'Green', color: 'bg-green-600' },
                      { name: 'Purple', color: 'bg-purple-600' },
                    ].map((theme) => (
                      <button
                        key={theme.name}
                        className={`p-3 rounded-lg border-2 border-blue-600 ${theme.color} text-white font-medium`}
                      >
                        {theme.name}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Display Mode</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button className="p-3 rounded-lg border-2 border-blue-600 bg-blue-50 text-blue-700 font-medium">
                      Light Mode
                    </button>
                    <button className="p-3 rounded-lg border border-gray-300 text-gray-700 font-medium">
                      Dark Mode
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Layout Settings */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Layout Settings</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-gray-900">Compact Mode</div>
                    <div className="text-sm text-gray-500">Reduce spacing and padding</div>
                  </div>
                  <button className="relative inline-flex h-6 w-11 items-center rounded-full bg-gray-200">
                    <span className="inline-block h-4 w-4 transform rounded-full bg-white transition translate-x-1" />
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-gray-900">Sidebar Collapsed</div>
                    <div className="text-sm text-gray-500">Start with collapsed sidebar</div>
                  </div>
                  <button className="relative inline-flex h-6 w-11 items-center rounded-full bg-gray-200">
                    <span className="inline-block h-4 w-4 transform rounded-full bg-white transition translate-x-1" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Device Preview */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Device Preview</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="text-center p-4 border border-gray-200 rounded-lg">
                <Monitor className="h-8 w-8 text-blue-600 mx-auto mb-2" />
                <div className="font-medium text-gray-900">Desktop</div>
                <div className="text-sm text-gray-500">1920x1080</div>
              </div>
              <div className="text-center p-4 border border-gray-200 rounded-lg">
                <Tablet className="h-8 w-8 text-green-600 mx-auto mb-2" />
                <div className="font-medium text-gray-900">Tablet</div>
                <div className="text-sm text-gray-500">768x1024</div>
              </div>
              <div className="text-center p-4 border border-gray-200 rounded-lg">
                <Smartphone className="h-8 w-8 text-orange-600 mx-auto mb-2" />
                <div className="font-medium text-gray-900">Mobile</div>
                <div className="text-sm text-gray-500">375x667</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* User Form Modal (for adding new users) */}
      {showUserForm && labId && (
        <UserFormComponent
          onClose={() => { setShowUserForm(false); setSelectedUser(null); }}
          user={selectedUser || undefined}
          permissions={permissions}
          availableRoles={availableRoles}
          labId={labId}
          onSave={() => {
            // Reload users after save
            setSelectedUser(null);
            // Trigger reload
            if (labId) {
              const reloadUsers = async () => {
                const { data: labUsers } = await supabase
                  .from('users')
                  .select('*')
                  .eq('lab_id', labId)
                  .order('name');
                
                setUsers((labUsers || []).map((u: any) => ({
                  id: u.id,
                  name: u.name,
                  email: u.email,
                  role: u.role || 'Technician',
                  department: u.department || '',
                  status: u.status === 'Active' ? 'Active' : u.status === 'Inactive' ? 'Inactive' : 'Suspended',
                  lastLogin: u.last_login || 'Never',
                  permissions: [],
                  phone: u.phone || '',
                  joinDate: u.join_date || new Date().toISOString(),
                })));
              };
              reloadUsers();
            }
          }}
        />
      )}

      {/* Edit User Modal (for editing existing users - no auth changes) */}
      {showEditUserModal && selectedUser && labId && (
        <EditUserModal
          user={selectedUser}
          onClose={() => { setShowEditUserModal(false); setSelectedUser(null); }}
          onSuccess={() => {
            // Reload users after successful edit
            if (labId) {
              const reloadUsers = async () => {
                const { data: labUsers } = await supabase
                  .from('users')
                  .select('*')
                  .eq('lab_id', labId)
                  .order('name');
                
                setUsers((labUsers || []).map((u: any) => ({
                  id: u.id,
                  name: u.name,
                  email: u.email,
                  role: u.role || 'Technician',
                  department: u.department || '',
                  status: u.status === 'Active' ? 'Active' : u.status === 'Inactive' ? 'Inactive' : 'Suspended',
                  lastLogin: u.last_login || 'Never',
                  permissions: [],
                  phone: u.phone || '',
                  joinDate: u.join_date || new Date().toISOString(),
                })));
              };
              reloadUsers();
            }
          }}
          isAdmin={authUser?.user_metadata?.role === 'Admin'}
        />
      )}
    </div>
  );
};

export default Settings;