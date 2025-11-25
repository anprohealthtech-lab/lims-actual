// src/pages/WhatsApp.tsx
import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs.tsx';
import WhatsAppDashboard from '../components/WhatsApp/WhatsAppDashboard';
import WhatsAppMessaging from '../components/WhatsApp/WhatsAppMessaging';
import MessageHistory from '../components/WhatsApp/MessageHistory';
import WhatsAppUserSyncManager from '../components/WhatsApp/WhatsAppUserSyncManager';
import { MessageResult } from '../utils/whatsappAPI';

const WhatsApp: React.FC = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');

  const handleConnectionChange = (connected: boolean) => {
    setIsConnected(connected);
  };

  const handleMessageSent = (result: MessageResult) => {
    if (result.success) {
      // Switch to history tab to show the sent message
      setActiveTab('history');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">WhatsApp Integration</h1>
          <p className="text-gray-600 mt-2">
            Send PDF reports and messages to patients via WhatsApp
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <div className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${isConnected
              ? 'bg-green-100 text-green-800'
              : 'bg-red-100 text-red-800'
            }`}>
            <span className={`w-2 h-2 rounded-full mr-2 ${isConnected ? 'bg-green-500' : 'bg-red-500'
              }`}></span>
            {isConnected ? 'Connected' : 'Disconnected'}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="dashboard">Connection</TabsTrigger>
          <TabsTrigger value="messaging">Send Message</TabsTrigger>
          <TabsTrigger value="history">Message History</TabsTrigger>
          <TabsTrigger value="sync">User Management</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-6">
          <WhatsAppDashboard onConnectionChange={handleConnectionChange} />
        </TabsContent>

        <TabsContent value="messaging" className="space-y-6">
          <WhatsAppMessaging
            isConnected={isConnected}
            onMessageSent={handleMessageSent}
          />
        </TabsContent>

        <TabsContent value="history" className="space-y-6">
          <MessageHistory />
        </TabsContent>

        <TabsContent value="sync" className="space-y-6">
          <WhatsAppUserSyncManager />
        </TabsContent>
      </Tabs>

      {/* Quick Start Guide - Accordion Style */}
      {!isConnected && (
        <details className="group bg-blue-50 border border-blue-200 rounded-lg overflow-hidden" open>
          <summary className="flex items-center justify-between p-4 cursor-pointer hover:bg-blue-100 transition-colors select-none">
            <div className="flex items-center space-x-2">
              <div className="bg-blue-600 p-1.5 rounded-full">
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-blue-900">
                Getting Started with WhatsApp Integration
              </h3>
            </div>
            <svg className="w-5 h-5 text-blue-500 transform group-open:rotate-180 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </summary>

          <div className="p-6 pt-0 space-y-4 border-t border-blue-200/50 mt-4">
            <div className="flex items-start space-x-3">
              <div className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-bold shadow-sm">
                1
              </div>
              <div>
                <div className="font-medium text-blue-900">Connect WhatsApp</div>
                <div className="text-sm text-blue-800 mt-0.5">
                  Go to the "Connection" tab and click "Connect" to generate a QR code
                </div>
              </div>
            </div>

            <div className="flex items-start space-x-3">
              <div className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-bold shadow-sm">
                2
              </div>
              <div>
                <div className="font-medium text-blue-900">Scan QR Code</div>
                <div className="text-sm text-blue-800 mt-0.5">
                  Open WhatsApp on your phone, go to Settings → Linked Devices → Link a Device
                </div>
              </div>
            </div>

            <div className="flex items-start space-x-3">
              <div className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-bold shadow-sm">
                3
              </div>
              <div>
                <div className="font-medium text-blue-900">Start Sending Messages</div>
                <div className="text-sm text-blue-800 mt-0.5">
                  Once connected, use the "Send Message" tab to send reports and messages to patients
                </div>
              </div>
            </div>
          </div>
        </details>
      )}
    </div>
  );
};

export default WhatsApp;