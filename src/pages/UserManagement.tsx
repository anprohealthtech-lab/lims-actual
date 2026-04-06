import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  Users,
  Plus,
  Edit,
  Trash2,
  Search,
  UserCheck,
  UserX,
  Clock,
  Mail,
  Shield,
  MapPin,
  Calendar,
  Lock,
  Loader,
  KeyRound,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle,
} from 'lucide-react';
import { supabase, database } from '../utils/supabase';
import { isAdminOrManager } from '../utils/permissions';
import AddUserMinimalModal from '../components/Users/AddUserMinimalModal';
import EditUserModal from '../components/Users/EditUserModal';

interface User {
  id: string;
  name: string;
  email: string;
  contact_number: string;
  gender: string;
  status: string;
  join_date: string;
  last_login: string;
  role_name: string;
  role_code: string;
  permissions: string[];
  assigned_centers: string[];
  lab_id: string;
  is_phlebotomist: boolean;
}

const UserManagement: React.FC = () => {
  const { user: authUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [labId, setLabId] = useState<string | null>(null);
  const [showAddUser, setShowAddUser] = useState(false);
  const [showUserModal, setShowUserModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [error, setError] = useState('');
  const [hasAccess, setHasAccess] = useState<boolean | null>(null);
  const [checkingAccess, setCheckingAccess] = useState(true);

  // Reset password state
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetShowPw, setResetShowPw] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState('');
  const [resetDone, setResetDone] = useState(false);

  // Check if user has admin/manager access
  useEffect(() => {
    const checkAccess = async () => {
      if (!authUser?.id) {
        setCheckingAccess(false);
        setHasAccess(false);
        return;
      }
      
      setCheckingAccess(true);
      try {
        const canAccess = await isAdminOrManager(authUser.id, authUser.email);
        setHasAccess(canAccess);
      } catch (err) {
        console.error('Error checking access:', err);
        setHasAccess(false);
      } finally {
        setCheckingAccess(false);
      }
    };
    
    checkAccess();
  }, [authUser?.id, authUser?.email]);

  // Load users
  useEffect(() => {
    loadUsers();
  }, []);

  // Filter users
  useEffect(() => {
    let filtered = users;

    if (searchTerm) {
      filtered = filtered.filter(user =>
        user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        user.contact_number?.includes(searchTerm)
      );
    }

    if (roleFilter !== 'all') {
      filtered = filtered.filter(user => user.role_code === roleFilter);
    }

    if (statusFilter !== 'all') {
      filtered = filtered.filter(user => user.status === statusFilter);
    }

    setFilteredUsers(filtered);
  }, [users, searchTerm, roleFilter, statusFilter]);

  const loadUsers = async () => {
    try {
      setLoading(true);
      setError('');

      const currentLabId = await database.getCurrentUserLabId();
      if (!currentLabId) {
        setError('No lab context found');
        return;
      }
      
      setLabId(currentLabId);

      // Load users with permissions and roles from the view
      const { data, error } = await supabase
        .from('v_users_with_permissions')
        .select('*')
        .eq('lab_id', currentLabId)
        .order('name');

      if (error) throw error;

      setUsers(data || []);
    } catch (err: any) {
      console.error('Error loading users:', err);
      setError(err.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const handleTogglePhlebotomist = async (userId: string, currentStatus: boolean) => {
    try {
      const { error } = await database.users.updatePhlebotomistStatus(userId, !currentStatus);
      if (error) throw error;

      // Update local state
      setUsers(prev =>
        prev.map(u =>
          u.id === userId ? { ...u, is_phlebotomist: !currentStatus } : u
        )
      );
    } catch (error) {
      console.error('Error updating phlebotomist status:', error);
      alert('Failed to update phlebotomist status');
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!confirm('Are you sure you want to deactivate this user?')) return;

    try {
      const { error } = await supabase
        .from('users')
        .update({ status: 'Inactive' })
        .eq('id', userId);

      if (error) throw error;

      // Reload users
      await loadUsers();
    } catch (error) {
      console.error('Error deactivating user:', error);
      alert('Failed to deactivate user');
    }
  };

  const openResetModal = (user: User) => {
    setResetTarget(user);
    setResetPassword('');
    setResetConfirm('');
    setResetError('');
    setResetDone(false);
  };

  const closeResetModal = () => {
    setResetTarget(null);
    setResetPassword('');
    setResetConfirm('');
    setResetError('');
    setResetDone(false);
  };

  const handleResetPassword = async () => {
    if (!resetTarget) return;
    setResetError('');

    if (resetPassword.length < 6) {
      setResetError('Password must be at least 6 characters');
      return;
    }
    if (resetPassword !== resetConfirm) {
      setResetError('Passwords do not match');
      return;
    }

    setResetLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-reset-password', {
        body: { target_user_id: resetTarget.id, new_password: resetPassword },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setResetDone(true);
    } catch (err: any) {
      setResetError(err.message || 'Failed to reset password');
    } finally {
      setResetLoading(false);
    }
  };

  // Helper functions for badges and formatting
  const getStatusBadge = (status: string) => {
    const styles = {
      Active: 'bg-green-100 text-green-800',
      Inactive: 'bg-red-100 text-red-800',
      Suspended: 'bg-yellow-100 text-yellow-800',
    };
    return styles[status as keyof typeof styles] || 'bg-gray-100 text-gray-800';
  };

  const getRoleBadge = (roleCode: string) => {
    const styles = {
      admin: 'bg-purple-100 text-purple-800',
      lab_manager: 'bg-blue-100 text-blue-800',
      doctor: 'bg-teal-100 text-teal-800',
      technician: 'bg-cyan-100 text-cyan-800',
      phlebotomist: 'bg-orange-100 text-orange-800',
      receptionist: 'bg-pink-100 text-pink-800',
      finance_manager: 'bg-green-100 text-green-800',
      quality_control: 'bg-indigo-100 text-indigo-800',
    };
    return styles[roleCode as keyof typeof styles] || 'bg-gray-100 text-gray-800';
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString();
  };

  const formatDateTime = (dateString?: string) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleString();
  };

  const activeUsers = users.filter(u => u.status === 'Active').length;
  const inactiveUsers = users.filter(u => u.status === 'Inactive').length;
  const phlebotomists = users.filter(u => u.is_phlebotomist).length;

  // Show loading while checking access
  if (checkingAccess) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader className="h-8 w-8 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">Checking permissions...</p>
        </div>
      </div>
    );
  }

  // Show access denied if not admin/manager
  if (!hasAccess) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Lock className="h-8 w-8 text-red-600" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Access Denied</h2>
          <p className="text-gray-600">
            You don't have permission to access User Management. 
            This page is only available to administrators and managers.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">User Management</h1>
          <p className="text-gray-600 mt-1">Manage lab staff and permissions</p>
        </div>
        <button
          onClick={() => {
            if (!labId) {
              alert('Lab context is still loading. Please wait...');
              return;
            }
            setEditingUser(null);
            setShowUserModal(true);
          }}
          disabled={!labId}
          className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add User
        </button>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
          {error}
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center">
            <div className="bg-blue-100 p-3 rounded-lg">
              <Users className="h-6 w-6 text-blue-600" />
            </div>
            <div className="ml-4">
              <div className="text-2xl font-bold text-gray-900">{users.length}</div>
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
              <div className="text-2xl font-bold text-gray-900">{activeUsers}</div>
              <div className="text-sm text-gray-600">Active Users</div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center">
            <div className="bg-orange-100 p-3 rounded-lg">
              <Shield className="h-6 w-6 text-orange-600" />
            </div>
            <div className="ml-4">
              <div className="text-2xl font-bold text-gray-900">{phlebotomists}</div>
              <div className="text-sm text-gray-600">Phlebotomists</div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center">
            <div className="bg-red-100 p-3 rounded-lg">
              <UserX className="h-6 w-6 text-red-600" />
            </div>
            <div className="ml-4">
              <div className="text-2xl font-bold text-gray-900">{inactiveUsers}</div>
              <div className="text-sm text-gray-600">Inactive Users</div>
            </div>
          </div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search users by name, email, or contact..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Roles</option>
            <option value="admin">Admin</option>
            <option value="lab_manager">Lab Manager</option>
            <option value="doctor">Doctor</option>
            <option value="technician">Technician</option>
            <option value="phlebotomist">Phlebotomist</option>
            <option value="receptionist">Receptionist</option>
            <option value="finance_manager">Finance Manager</option>
            <option value="quality_control">Quality Control</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Status</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
            <option value="Suspended">Suspended</option>
          </select>
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            Team Members ({filteredUsers.length})
          </h2>
        </div>
        
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading users...</div>
        ) : filteredUsers.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No users found matching your criteria
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    User
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Role
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Contact
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Joined
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Last Login
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredUsers.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-10 w-10 bg-blue-100 rounded-full flex items-center justify-center">
                          <span className="text-blue-600 font-medium text-sm">
                            {user.name?.substring(0, 2).toUpperCase() || 'U'}
                          </span>
                        </div>
                        <div className="ml-4">
                          <div className="flex items-center">
                            <div className="text-sm font-medium text-gray-900">{user.name}</div>
                            {user.is_phlebotomist && (
                              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-800">
                                Phlebotomist
                              </span>
                            )}
                          </div>
                          <div className="text-sm text-gray-500 flex items-center">
                            <Mail className="h-3 w-3 mr-1" />
                            {user.email}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getRoleBadge(user.role_code)}`}>
                        {user.role_name}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{user.contact_number || 'N/A'}</div>
                      {user.assigned_centers && user.assigned_centers.length > 0 && (
                        <div className="flex items-center text-xs text-gray-500 mt-1">
                          <MapPin className="h-3 w-3 mr-1" />
                          {user.assigned_centers.length} center(s)
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getStatusBadge(user.status)}`}>
                        {user.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center text-sm text-gray-500">
                        <Calendar className="h-3 w-3 mr-1" />
                        {formatDate(user.join_date)}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center text-sm text-gray-500">
                        <Clock className="h-3 w-3 mr-1" />
                        {formatDateTime(user.last_login)}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => {
                            setEditingUser(user);
                            setShowEditModal(true);
                          }}
                          className="text-blue-600 hover:text-blue-900 p-1 rounded hover:bg-blue-50"
                          title="Edit user"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => openResetModal(user)}
                          className="text-amber-600 hover:text-amber-900 p-1 rounded hover:bg-amber-50"
                          title="Reset password"
                        >
                          <KeyRound className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteUser(user.id)}
                          className="text-red-600 hover:text-red-900 p-1 rounded hover:bg-red-50"
                          title="Deactivate user"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add User Modal (minimal - auth only) */}
      {showUserModal && labId && (
        <AddUserMinimalModal
          onClose={() => {
            setShowUserModal(false);
            setEditingUser(null);
          }}
          onSuccess={(_userId, _email) => {
            setShowUserModal(false);
            setEditingUser(null);
            loadUsers();
          }}
          labId={labId}
        />
      )}

      {/* Edit User Modal (for existing users only) */}
      {showEditModal && editingUser && (
        <EditUserModal
          user={editingUser}
          onClose={() => {
            setShowEditModal(false);
            setEditingUser(null);
          }}
          onSuccess={() => {
            setShowEditModal(false);
            setEditingUser(null);
            loadUsers();
          }}
        />
      )}

      {/* Admin Reset Password Modal */}
      {resetTarget && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Reset Password</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  Setting new password for <span className="font-medium text-gray-700">{resetTarget.name}</span>
                </p>
              </div>
              <button onClick={closeResetModal} className="text-gray-400 hover:text-gray-600">
                <span className="sr-only">Close</span>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {resetDone ? (
                <div className="flex items-start gap-3 bg-green-50 border border-green-200 rounded-lg p-4">
                  <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
                  <div className="text-sm text-green-800">
                    <p className="font-medium">Password updated!</p>
                    <p className="mt-0.5">
                      {resetTarget.name} can now log in with the new password.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  {resetError && (
                    <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg p-3">
                      <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
                      <span className="text-sm text-red-700">{resetError}</span>
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      New Password
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <input
                        type={resetShowPw ? 'text' : 'password'}
                        value={resetPassword}
                        onChange={(e) => { setResetPassword(e.target.value); setResetError(''); }}
                        className="pl-9 pr-10 w-full py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                        placeholder="Min. 6 characters"
                        autoComplete="new-password"
                      />
                      <button
                        type="button"
                        onClick={() => setResetShowPw(!resetShowPw)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        {resetShowPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Confirm New Password
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <input
                        type={resetShowPw ? 'text' : 'password'}
                        value={resetConfirm}
                        onChange={(e) => { setResetConfirm(e.target.value); setResetError(''); }}
                        className="pl-9 w-full py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                        placeholder="Re-enter new password"
                        autoComplete="new-password"
                      />
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-lg">
              <button
                onClick={closeResetModal}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                {resetDone ? 'Close' : 'Cancel'}
              </button>
              {!resetDone && (
                <button
                  onClick={handleResetPassword}
                  disabled={resetLoading || !resetPassword || !resetConfirm}
                  className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {resetLoading ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                  ) : (
                    <KeyRound className="h-4 w-4" />
                  )}
                  {resetLoading ? 'Resetting...' : 'Reset Password'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserManagement;
