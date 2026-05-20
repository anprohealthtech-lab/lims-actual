import { useState, useEffect } from 'react';
import { 
  Plus, 
  Search, 
  Filter, 
  Users, 
  Calendar, 
  TestTube, 
  Eye, 
  Clock,
  DollarSign,
  Activity,
  ChevronRight,
  ChevronDown,
  AlertCircle,
  CheckCircle,
  Link2
} from 'lucide-react';
import { supabase } from '../../utils/supabase';
import { getCalendarDateRangeStrings } from '../../utils/dateRangeFilters';
import PatientSessionDashboard from './PatientSessionDashboard';
import SmartTestAddition from './SmartTestAddition';

type SessionDateRange = 'today' | 'week' | 'month';

interface PatientSession {
  visit_group_id: string;
  patient_id: string;
  patient_name: string;
  patient_email: string;
  patient_phone: string;
  session_date: string;
  doctor: string;
  total_orders: number;
  total_tests: number;
  total_amount: number;
  session_status: 'active' | 'completed' | 'cancelled';
  orders: Array<{
    id: string;
    order_type: string;
    status: string;
    created_at: string;
    can_add_tests: boolean;
    locked_at?: string;
    parent_order_id?: string;
    addition_reason?: string;
    test_count: number;
    amount: number;
  }>;
  latest_activity: {
    activity_type: string;
    description: string;
    performed_at: string;
  };
}

export default function EnhancedOrders() {
  const [sessions, setSessions] = useState<PatientSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [selectedDateRange, setSelectedDateRange] = useState<SessionDateRange>('today');
  const [expandedSessions, setExpandedSessions] = useState<{[key: string]: boolean}>({});
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [showTestAddition, setShowTestAddition] = useState<{
    sessionId: string;
    patientId: string;
    currentOrderId?: string;
    currentOrderStatus?: string;
  } | null>(null);

  useEffect(() => {
    fetchPatientSessions();
  }, [selectedDateRange]);

  const fetchPatientSessions = async () => {
    try {
      setLoading(true);
      
      // Determine date range
      let startDate: string;
      let endDate: string;

      switch (selectedDateRange) {
        case 'today':
        case 'week':
        case 'month': {
          const range = getCalendarDateRangeStrings(selectedDateRange);
          startDate = range.start;
          endDate = range.end;
          break;
        }
        default:
          ({ start: startDate, end: endDate } = getCalendarDateRangeStrings('today'));
      }

      // Fetch orders grouped by visit sessions
      const { data: ordersData, error: ordersError } = await supabase
        .from('orders')
        .select(`
          *,
          patients (
            id, name, email, phone
          ),
          order_test_groups (
            id,
            test_groups (
              id, name, price
            )
          )
        `)
        .gte('order_date', startDate)
        .lt('order_date', endDate)
        .order('order_date', { ascending: false })
        .order('created_at', { ascending: false });

      if (ordersError) throw ordersError;

      // Group orders by visit_group_id
      const sessionMap = new Map<string, PatientSession>();

      for (const order of ordersData || []) {
        const visitGroupId = order.visit_group_id || `single-${order.id}`;
        
        if (!sessionMap.has(visitGroupId)) {
          // Fetch latest activity for this patient
          const { data: latestActivity } = await supabase
            .from('patient_activity_log')
            .select('activity_type, description, performed_at')
            .eq('patient_id', order.patient_id)
            .order('performed_at', { ascending: false })
            .limit(1);

          sessionMap.set(visitGroupId, {
            visit_group_id: visitGroupId,
            patient_id: order.patient_id,
            patient_name: order.patients?.name || 'Unknown Patient',
            patient_email: order.patients?.email || '',
            patient_phone: order.patients?.phone || '',
            session_date: order.order_date,
            doctor: order.doctor || '',
            total_orders: 0,
            total_tests: 0,
            total_amount: 0,
            session_status: 'active',
            orders: [],
            latest_activity: latestActivity?.[0] || {
              activity_type: 'order_created',
              description: 'Order created',
              performed_at: order.created_at
            }
          });
        }

        const session = sessionMap.get(visitGroupId)!;
        
        // Add order to session
        session.orders.push({
          id: order.id,
          order_type: order.order_type || 'initial',
          status: order.status,
          created_at: order.created_at,
          can_add_tests: order.can_add_tests ?? true,
          locked_at: order.locked_at,
          parent_order_id: order.parent_order_id,
          addition_reason: order.addition_reason,
          test_count: order.order_test_groups?.length || 0,
          amount: order.total_amount || 0
        });

        // Update session totals
        session.total_orders += 1;
        session.total_tests += order.order_test_groups?.length || 0;
        session.total_amount += order.total_amount || 0;

        // Determine session status
        if (order.status === 'cancelled') {
          session.session_status = 'cancelled';
        } else if (session.orders.every(o => o.status === 'completed')) {
          session.session_status = 'completed';
        } else {
          session.session_status = 'active';
        }
      }

      setSessions(Array.from(sessionMap.values()));
    } catch (error) {
      console.error('Error fetching patient sessions:', error);
      setError('Failed to load patient sessions');
    } finally {
      setLoading(false);
    }
  };

  const filteredSessions = sessions.filter(session => {
    const matchesSearch = session.patient_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         session.visit_group_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         session.patient_email.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = selectedStatus === 'all' || session.session_status === selectedStatus;
    
    return matchesSearch && matchesStatus;
  });

  const toggleSessionExpansion = (sessionId: string) => {
    setExpandedSessions(prev => ({
      ...prev,
      [sessionId]: !prev[sessionId]
    }));
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-blue-100 text-blue-800';
      case 'completed': return 'bg-green-100 text-green-800';
      case 'cancelled': return 'bg-red-100 text-red-800';
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      case 'in_progress': return 'bg-orange-100 text-orange-800';
      case 'sample_collection': return 'bg-purple-100 text-purple-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getOrderTypeIcon = (orderType: string) => {
    switch (orderType) {
      case 'initial': return <TestTube className="h-4 w-4" />;
      case 'additional': return <Plus className="h-4 w-4" />;
      case 'urgent': return <AlertCircle className="h-4 w-4" />;
      case 'follow_up': return <Link2 className="h-4 w-4" />;
      default: return <TestTube className="h-4 w-4" />;
    }
  };

  const formatCurrency = (amount: number) => {
    return `₹${amount.toLocaleString('en-IN')}`;
  };

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  };

  const openTestAddition = (sessionId: string, patientId: string, currentOrderId?: string, currentOrderStatus?: string) => {
    setShowTestAddition({
      sessionId,
      patientId,
      currentOrderId,
      currentOrderStatus
    });
  };

  const handleTestsAdded = (tests: any[], orderType: 'modify' | 'additional') => {
    console.log('Tests added:', tests, 'Order type:', orderType);
    setShowTestAddition(null);
    fetchPatientSessions(); // Refresh data
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6">
        <div className="flex items-center">
          <AlertCircle className="h-5 w-5 text-red-400 mr-2" />
          <span className="text-red-800">{error}</span>
        </div>
      </div>
    );
  }

  if (selectedSession) {
    return (
      <div>
        <div className="mb-6">
          <button
            onClick={() => setSelectedSession(null)}
            className="inline-flex items-center text-blue-600 hover:text-blue-800"
          >
            ← Back to Sessions
          </button>
        </div>
        <PatientSessionDashboard 
          sessionId={selectedSession}
          onSessionCreate={() => setSelectedSession(null)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Patient Sessions</h1>
          <p className="mt-2 text-gray-600">
            Patient-centric workflow with order chaining and test addition flexibility
          </p>
        </div>
        <button
          onClick={() => window.location.href = '/orders/new'}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center hover:bg-blue-700 transition-colors"
        >
          <Plus className="h-5 w-5 mr-2" />
          New Session
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-64">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
              <input
                type="text"
                placeholder="Search patients, sessions, or email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>
          
          <div className="flex items-center space-x-2">
            <Filter className="h-5 w-5 text-gray-400" />
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          
          <div className="flex items-center space-x-2">
            <Calendar className="h-5 w-5 text-gray-400" />
            <select
              value={selectedDateRange}
              onChange={(e) => setSelectedDateRange(e.target.value as SessionDateRange)}
              className="border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="today">Today</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
            </select>
          </div>
        </div>
      </div>

      {/* Sessions List */}
      <div className="space-y-4">
        {filteredSessions.length === 0 ? (
          <div className="bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg p-12 text-center">
            <Users className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Patient Sessions</h3>
            <p className="text-gray-500 mb-4">No patient sessions found for the selected criteria.</p>
          </div>
        ) : (
          filteredSessions.map(session => (
            <div key={session.visit_group_id} className="bg-white rounded-lg shadow-sm border border-gray-200">
              {/* Session Header */}
              <div className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <button
                      onClick={() => toggleSessionExpansion(session.visit_group_id)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      {expandedSessions[session.visit_group_id] ? (
                        <ChevronDown className="h-5 w-5" />
                      ) : (
                        <ChevronRight className="h-5 w-5" />
                      )}
                    </button>
                    
                    <div className="bg-blue-100 rounded-full p-2">
                      <Users className="h-6 w-6 text-blue-600" />
                    </div>
                    
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">
                        {session.patient_name}
                      </h3>
                      <p className="text-sm text-gray-500">
                        Session #{session.visit_group_id} • {session.patient_email}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-4">
                    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(session.session_status)}`}>
                      {session.session_status === 'active' && <Activity className="h-3 w-3 mr-1" />}
                      {session.session_status === 'completed' && <CheckCircle className="h-3 w-3 mr-1" />}
                      {session.session_status === 'cancelled' && <AlertCircle className="h-3 w-3 mr-1" />}
                      {session.session_status.charAt(0).toUpperCase() + session.session_status.slice(1)}
                    </span>
                    
                    <button
                      onClick={() => setSelectedSession(session.visit_group_id)}
                      className="text-blue-600 hover:text-blue-800"
                    >
                      <Eye className="h-5 w-5" />
                    </button>
                  </div>
                </div>
                
                {/* Session Summary */}
                <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="flex items-center space-x-2">
                    <TestTube className="h-4 w-4 text-gray-400" />
                    <span className="text-sm text-gray-600">
                      {session.total_tests} tests
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <DollarSign className="h-4 w-4 text-gray-400" />
                    <span className="text-sm text-gray-600">
                      {formatCurrency(session.total_amount)}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Clock className="h-4 w-4 text-gray-400" />
                    <span className="text-sm text-gray-600">
                      {new Date(session.session_date).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Activity className="h-4 w-4 text-gray-400" />
                    <span className="text-sm text-gray-600">
                      {session.latest_activity.description}
                    </span>
                  </div>
                </div>
              </div>
              
              {/* Expanded Orders */}
              {expandedSessions[session.visit_group_id] && (
                <div className="border-t border-gray-200 bg-gray-50">
                  <div className="p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="font-medium text-gray-900">Orders in Session</h4>
                      {session.session_status === 'active' && (
                        <button
                          onClick={() => openTestAddition(
                            session.visit_group_id,
                            session.patient_id,
                            session.orders[0]?.id,
                            session.orders[0]?.status
                          )}
                          className="inline-flex items-center px-3 py-1 border border-blue-300 text-blue-600 rounded-md text-sm hover:bg-blue-50"
                        >
                          <Plus className="h-3 w-3 mr-1" />
                          Add Tests
                        </button>
                      )}
                    </div>
                    
                    <div className="space-y-3">
                      {session.orders.map(order => (
                        <div key={order.id} className="bg-white border border-gray-200 rounded-lg p-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-3">
                              <div className={`p-2 rounded-full ${
                                order.order_type === 'initial' ? 'bg-blue-100' :
                                order.order_type === 'additional' ? 'bg-green-100' :
                                order.order_type === 'urgent' ? 'bg-red-100' :
                                'bg-gray-100'
                              }`}>
                                {getOrderTypeIcon(order.order_type)}
                              </div>
                              <div>
                                <h5 className="font-medium text-gray-900">
                                  {order.order_type.charAt(0).toUpperCase() + order.order_type.slice(1)} Order
                                </h5>
                                <p className="text-sm text-gray-500">
                                  {order.test_count} tests • {formatCurrency(order.amount)} • {formatTime(order.created_at)}
                                </p>
                                {order.addition_reason && (
                                  <p className="text-xs text-blue-600 mt-1">
                                    Reason: {order.addition_reason}
                                  </p>
                                )}
                              </div>
                            </div>
                            
                            <div className="flex items-center space-x-2">
                              <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(order.status)}`}>
                                {order.status}
                              </span>
                              {order.can_add_tests && !order.locked_at && (
                                <span className="text-xs text-green-600">
                                  ✏️ Modifiable
                                </span>
                              )}
                              {order.locked_at && (
                                <span className="text-xs text-red-600">
                                  🔒 Locked
                                </span>
                              )}
                            </div>
                          </div>
                          
                          {order.parent_order_id && (
                            <div className="mt-2 text-xs text-gray-500 flex items-center">
                              <Link2 className="h-3 w-3 mr-1" />
                              Linked to parent order
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Test Addition Modal */}
      {showTestAddition && (
        <SmartTestAddition
          sessionId={showTestAddition.sessionId}
          patientId={showTestAddition.patientId}
          currentOrderId={showTestAddition.currentOrderId}
          currentOrderStatus={showTestAddition.currentOrderStatus}
          onTestsAdded={handleTestsAdded}
          onClose={() => setShowTestAddition(null)}
        />
      )}
    </div>
  );
}
