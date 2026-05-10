import React, { useState, useEffect } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { Fragment } from 'react';
import { X, Play, AlertTriangle } from 'lucide-react';
import { supabase } from '../../utils/supabase';
import { useEscapeModalClose } from '../../hooks/useEscapeModalClose';
// import ProtocolFlowEngine from './ProtocolFlowEngine';

interface AIProtocol {
  id: string;
  name: string;
  description: string;
  category: string;
  config: any;
  ui_config: any;
  requires_lims_integration: boolean;
  target_table: string | null;
}

interface AIProtocolSession {
  id: string;
  protocol_id: string;
  status: 'started' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  current_step_order: number;
  session_data: any;
  results: any;
  started_at: string;
  completed_at?: string;
}

interface AIUtilityModalProps {
  isOpen: boolean;
  onClose: () => void;
  context?: {
    orderId?: string;
    patientId?: string;
    testId?: string;
    placement: string;
  };
}

const AIUtilityModal: React.FC<AIUtilityModalProps> = ({ isOpen, onClose, context }) => {
  useEscapeModalClose(onClose, isOpen);
  const [protocols, setProtocols] = useState<AIProtocol[]>([]);
  const [selectedProtocol, setSelectedProtocol] = useState<AIProtocol | null>(null);
  const [currentSession, setCurrentSession] = useState<AIProtocolSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<'selection' | 'execution'>('selection');

  useEffect(() => {
    if (isOpen) {
      loadProtocols();
    }
  }, [isOpen]);

  const loadProtocols = async () => {
    try {
      setLoading(true);
      
      // Load protocols based on context
      let query = supabase
        .from('ai_protocols')
        .select('*')
        .eq('is_active', true);

      // Filter by placement context if available
      if (context?.placement) {
        // This would filter protocols based on where they're launched from
        // For now, load all active protocols
      }

      const { data, error } = await query.order('category', { ascending: true });

      if (error) throw error;
      setProtocols(data || []);
    } catch (error) {
      console.error('Error loading protocols:', error);
    } finally {
      setLoading(false);
    }
  };

  const startProtocol = async (protocol: AIProtocol) => {
    try {
      setLoading(true);

      // Create new session
      const sessionData = {
        protocol_id: protocol.id,
        order_id: context?.orderId || null,
        patient_id: context?.patientId || null,
        test_id: context?.testId || null,
        status: 'started',
        current_step_order: 1,
        session_data: {},
        user_id: (await supabase.auth.getUser()).data.user?.id
      };

      const { data: session, error } = await supabase
        .from('ai_protocol_sessions')
        .insert(sessionData)
        .select()
        .single();

      if (error) throw error;

      setCurrentSession(session);
      setSelectedProtocol(protocol);
      setView('execution');
    } catch (error) {
      console.error('Error starting protocol:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSessionComplete = async (sessionResults: any) => {
    if (!currentSession) return;

    try {
      // Update session as completed
      const { error } = await supabase
        .from('ai_protocol_sessions')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          results: sessionResults
        })
        .eq('id', currentSession.id);

      if (error) throw error;

      // If LIMS integration required, update target table
      if (selectedProtocol?.requires_lims_integration && selectedProtocol.target_table) {
        await updateLIMSData(sessionResults);
      }

      // Close modal after success
      setTimeout(() => {
        onClose();
      }, 2000);

    } catch (error) {
      console.error('Error completing session:', error);
    }
  };

  const updateLIMSData = async (results: any) => {
    // This would update the appropriate LIMS table based on protocol configuration
    // Implementation depends on specific result mapping rules
    console.log('Updating LIMS data:', results);
  };

  const handleModalClose = () => {
    setView('selection');
    setSelectedProtocol(null);
    setCurrentSession(null);
    onClose();
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'document':
        return '📄';
      case 'image':
        return '📷';
      case 'validation':
        return '🔬';
      case 'analysis':
        return '🧪';
      default:
        return '🤖';
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'document':
        return 'bg-blue-100 text-blue-800';
      case 'image':
        return 'bg-green-100 text-green-800';
      case 'validation':
        return 'bg-purple-100 text-purple-800';
      case 'analysis':
        return 'bg-orange-100 text-orange-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={handleModalClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black bg-opacity-25" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-4xl transform overflow-hidden rounded-2xl bg-white p-6 text-left align-middle shadow-xl transition-all">
                <div className="flex items-center justify-between mb-6">
                  <Dialog.Title as="h3" className="text-lg font-medium leading-6 text-gray-900">
                    {view === 'selection' ? 'AI Utility Protocols' : `${selectedProtocol?.name}`}
                  </Dialog.Title>
                  <button
                    onClick={handleModalClose}
                    className="rounded-md bg-white text-gray-400 hover:text-gray-500 focus:outline-none"
                  >
                    <X className="h-6 w-6" />
                  </button>
                </div>

                {view === 'selection' && (
                  <div>
                    {loading ? (
                      <div className="flex justify-center py-8">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {protocols.map((protocol) => (
                          <div
                            key={protocol.id}
                            className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer"
                            onClick={() => startProtocol(protocol)}
                          >
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-2">
                                  <span className="text-2xl">{getCategoryIcon(protocol.category)}</span>
                                  <h4 className="font-medium text-gray-900">{protocol.name}</h4>
                                </div>
                                <p className="text-sm text-gray-600 mb-3">{protocol.description}</p>
                                <div className="flex items-center gap-2">
                                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getCategoryColor(protocol.category)}`}>
                                    {protocol.category}
                                  </span>
                                  {protocol.requires_lims_integration && (
                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">
                                      LIMS Integration
                                    </span>
                                  )}
                                </div>
                              </div>
                              <Play className="h-5 w-5 text-gray-400" />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {protocols.length === 0 && !loading && (
                      <div className="text-center py-8">
                        <AlertTriangle className="mx-auto h-12 w-12 text-gray-400" />
                        <h3 className="mt-2 text-sm font-medium text-gray-900">No protocols available</h3>
                        <p className="mt-1 text-sm text-gray-500">
                          No AI protocols are configured for this context.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {view === 'execution' && selectedProtocol && currentSession && (
                  <div className="text-center py-8">
                    <p className="text-gray-600">Protocol Flow Engine will be implemented here</p>
                    <p className="text-sm text-gray-500 mt-2">Protocol: {selectedProtocol.name}</p>
                  </div>
                  // <ProtocolFlowEngine
                  //   protocol={selectedProtocol}
                  //   session={currentSession}
                  //   onComplete={handleSessionComplete}
                  //   onCancel={handleModalClose}
                  // />
                )}
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
};

export default AIUtilityModal;
