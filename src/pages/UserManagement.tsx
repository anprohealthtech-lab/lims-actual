import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { 
  Users, 
  Plus, 
  Edit, 
  Trash2, 
  Search, 
  Filter,
  UserCheck,
  UserX,
  Clock,
  Mail,
  Phone,
  Shield,
  MapPin,
  Calendar
} from 'lucide-react';
import { supabase, database } from '../utils/supabase';
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
  const [users, setUsers] = useState<User[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showAddUser, setShowAddUser] = useState(false);
  const [showUserModal, setShowUserModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [error, setError] = useState('');

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

      const labId = await database.getCurrentUserLabId();
      if (!labId) {
        setError('No lab context found');
        return;
      }

      // Load users with permissions and roles from the view
      const { data, error } = await supabase
        .from('v_users_with_permissions')
        .select('*')
        .eq('lab_id', labId)
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
            setEditingUser(null);
            setShowUserModal(true);
          }}
          className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
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
      {showUserModal && (
        <AddUserMinimalModal
          onClose={() => {
            setShowUserModal(false);
            setEditingUser(null);
          }}
          onSuccess={(userId, email) => {
            setShowUserModal(false);
            setEditingUser(null);
            loadUsers();
          }}
          labId={authUser?.lab_id}
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
    </div>
  );
};

export default UserManagement;
