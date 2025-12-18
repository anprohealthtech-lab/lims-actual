// src/App.tsx
import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import ProtectedRoute from './components/Auth/ProtectedRoute';
import Login from './components/Auth/Login';
import Signup from './components/Auth/Signup';
import Layout from './components/Layout/Layout';
import Dashboard from './pages/Dashboard';
import Patients from './pages/Patients';
import Tests from './pages/Tests';
import Orders from './pages/Orders';
import Results from './pages/Results';
import Reports from './pages/Reports';
import PeripheralSmearDemo from './components/Workflows/PeripheralSmearDemo';
import Billing from './pages/Billing';
import CashReconciliation from './pages/CashReconciliation';
import AITools from './pages/AITools';
import UserManagement from './pages/UserManagement';
import Settings from './pages/Settings';
import ResultVerificationConsole from './pages/ResultVerificationConsole';
import { WorkflowManagement } from './pages/WorkflowManagement';
import WorkflowDemo from './pages/WorkflowDemo';
import OrderDetail from './pages/OrderDetail';
import WhatsApp from './pages/WhatsApp';
import WhatsAppUserSyncManager from './components/WhatsApp/WhatsAppUserSyncManager';
import WhatsAppTemplates from './pages/WhatsAppTemplates';
import { useWhatsAppAutoSync } from './hooks/useWhatsAppAutoSync';
import { warmupPuppeteer } from './utils/pdfService';
import { initializeNativePlatform, cleanupNativePlatform } from './utils/nativeInit';
import "./styles/print.css";

// ⬇️ New modern dashboard page
import Dashboard2 from './pages/Dashboard2';
import VisualFormBuilder from './pages/VisualFormBuilder';

// ⬇️ New AI-integrated results page
import Result2 from './pages/result2';

// ⬇️ Master Data Components
import DoctorMaster from './components/Masters/DoctorMaster';
import LocationMaster from './components/Masters/LocationMaster';
import TemplateStudio from './pages/TemplateStudio';
import TemplateStudioCKE from './pages/TemplateStudioCKE';
import { BrandingSettings } from './pages/BrandingSettings';
import WorkflowConfiguratorPage from './pages/WorkflowConfiguratorPage';
import WorkflowEvaluatorPage from './pages/WorkflowEvaluatorPage';
import WorkflowExplainerDemo from './pages/WorkflowExplainerDemo';
import AIPromptManager from './pages/AIPromptManager';
import WorkflowExplainerTestPage from './pages/WorkflowExplainerTestPage';
import OptimizationDemo from './pages/OptimizationDemo';
import OutsourcedReportsConsole from './pages/OutsourcedReportsConsole';
import OutsourcedReportsConsoleEnhanced from './pages/OutsourcedReportsConsoleEnhanced';
import OutsourcedTestsQueue from './pages/OutsourcedTestsQueue';
import OutsourcedLabsSettings from './pages/OutsourcedLabsSettings';
import IntraLabTransitQueue from './pages/IntraLabTransitQueue';
import ManageReportSections from './pages/settings/ManageReportSections';

const AppRoutes: React.FC = () => {
  const { user, loading } = useAuth();

  // Initialize WhatsApp auto-sync when user is authenticated
  useWhatsAppAutoSync();

  // Initialize native platform features
  useEffect(() => {
    initializeNativePlatform().catch(err => {
      console.warn('Native platform initialization failed:', err);
    });

    return () => {
      cleanupNativePlatform();
    };
  }, []);

  // Warm up Puppeteer instance for faster PDF generation
  useEffect(() => {
    // Warmup after a short delay to not block initial render
    const timer = setTimeout(() => {
      warmupPuppeteer().catch(err => {
        console.warn('Puppeteer warmup failed:', err);
      });
    }, 2000);

    return () => clearTimeout(timer);
  }, []);

  // Show loading state while auth is initializing
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <Routes>
      {/* Public routes */}
      <Route
        path="/login"
        element={user ? <Navigate to="/" replace /> : <Login />}
      />
      <Route
        path="/signup"
        element={user ? <Navigate to="/" replace /> : <Signup />}
      />

      {/* Protected routes */}
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <Layout>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                {/* New modern dashboard route */}
                <Route path="/dashboard2" element={<Dashboard2 />} />

                <Route path="/patients" element={<Patients />} />
                <Route path="/tests" element={<Tests />} />
                <Route path="/orders" element={<Orders />} />
                <Route path="/results" element={<Results />} />
                <Route path="/results2" element={<Result2 />} />
                <Route path="/results-verification" element={<ResultVerificationConsole />} />
                <Route path="/reports" element={<Reports />} />
                {/* Dev workflow demo route (no DB changes) */}
                <Route path="/workflow-demo/peripheral-smear" element={<PeripheralSmearDemo />} />
                <Route path="/billing" element={<Billing />} />
                <Route path="/cash-reconciliation" element={<CashReconciliation />} />
                <Route path="/ai-tools" element={<AITools />} />
                <Route path="/ai-prompts" element={<AIPromptManager />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/settings/branding" element={<BrandingSettings />} />
                <Route path="/user-management" element={<UserManagement />} />
                <Route path="/verification" element={<ResultVerificationConsole />} />
                <Route path="/workflows" element={<WorkflowManagement />} />
                <Route path="/workflow-demo" element={<WorkflowDemo />} />
                <Route path="/workflow-configurator" element={<WorkflowConfiguratorPage />} />
                <Route path="/workflow-evaluator/:protocolId" element={<WorkflowEvaluatorPage />} />
                <Route path="/workflow-explainer-demo" element={<WorkflowExplainerDemo />} />
                <Route path="/optimization-demo" element={<OptimizationDemo />} />
                <Route path="/visual-form-builder" element={<VisualFormBuilder />} />
                <Route path="/orders/:id" element={<OrderDetail />} />
                <Route path="/template-studio" element={<TemplateStudio />} />
                <Route path="/template-studio-cke" element={<TemplateStudioCKE />} />
                {/* WhatsApp Integration */}
                <Route path="/whatsapp" element={<WhatsApp />} />
                <Route path="/whatsapp/sync" element={<WhatsAppUserSyncManager />} />
                <Route path="/whatsapp/templates" element={<WhatsAppTemplates />} />
                {/* Master Data Routes */}
                <Route path="/outsourced-reports" element={<OutsourcedReportsConsoleEnhanced />} />
                <Route path="/outsourced-reports-legacy" element={<OutsourcedReportsConsole />} />
                <Route path="/outsourced-queue" element={<OutsourcedTestsQueue />} />
                <Route path="/sample-transit" element={<IntraLabTransitQueue />} />
                <Route path="/settings/outsourced-labs" element={<OutsourcedLabsSettings />} />
                <Route path="/settings/report-sections" element={<ManageReportSections />} />
                <Route path="/masters/doctors" element={<DoctorMaster />} />
                <Route path="/masters/locations" element={<LocationMaster />} />
              </Routes>
            </Layout>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
};

function App() {
  return (
    <AuthProvider>
      <Router>
        <AppRoutes />
      </Router>
    </AuthProvider>
  );
}

export default App;
