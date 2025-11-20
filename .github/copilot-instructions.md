# LIMS v2 - AI Copilot Instructions

## Project Overview

This is a Laboratory Information Management System (LIMS) v2 built with **React/TypeScript + Vite**, featuring multi-lab support, AI-powered workflows, comprehensive test result management, and advanced billing/invoicing. The system manages patients, orders, test results, result verification, billing, and workflow automation using a **patient-centric architecture** with Survey.js-based workflows.

**Key Stack**: React 18.3, TypeScript, Vite | Supabase (PostgreSQL) | Puppeteer + PDF.co API | Survey.js 1.9.x | CKEditor 5 | Netlify Functions

## Core Data Access Layer

**Always use centralized API in `src/utils/supabase.ts`**:
```typescript
// ❌ Wrong: Direct Supabase in components
const { data } = await supabase.from('orders').select('*');

// ✅ Correct: Use database object
const { data, error } = await database.orders.getAll();
const lab_id = await database.getCurrentUserLabId();
```

The `database` object exports these namespaces with CRUD operations: `patients`, `orders`, `results`, `invoices`, `payments`, `labs`, `users`, `doctors`, `locations`, `testWorkflowMap`, `workflows`, `workflowVersions`, `aiProtocols`. Each provides built-in error handling, lab-scoped filtering, and automatic order status updates.

## Multi-Lab Architecture

**Every operation respects lab boundaries:**
- Users belong to ONE lab (`users.lab_id`)
- All queries must filter by lab context
- Lab-specific test overrides: `lab_analytes` supersedes `analytes`
- Test group mappings: Lab-scoped via `WHERE lab_id = current_lab`

```typescript
// Always derive, never hardcode
const lab_id = await database.getCurrentUserLabId();
if (!lab_id) throw new Error('No lab context');
```

## Workflow System (Survey.js)

### Core Components
- **FlowManager** (`src/components/Workflow/FlowManager.tsx`) - Multi-step orchestration
- **WorkflowRunner** - Executes Survey.js → saves results
- **WorkflowConfigurator** - No-code design interface
- **WorkflowDemo** (`/workflow-demo`) - Safe testing (read-only)

### Database Schema
```
workflows → workflow_versions → order_workflow_instances → workflow_step_events
results ← auto-saved from Survey.js responses
test_workflow_map (lab-scoped mappings with test_code)
```

### Critical Rules
- ✅ Test at `/workflow-demo` before production
- ✅ Workflows are **lab-scoped + order-gated** (require valid order + lab)
- ✅ Results: Survey.js form → WorkflowRunner → `database.results.create()`
- ✅ Test mappings MUST include `test_code` from test group
- ❌ Don't create new workflow tables - use existing `results` + `result_values`

### Visual Form Builder (`/visual-form-builder`)
- SurveyJS Creator integration for no-code design
- Auto-generates AI specifications from form structure
- Configurable: step types, timers, image capture, file uploads
- File upload questions → camera capture on mobile

## Result Verification State Machine

Multi-stage with security:
```
pending_verification → verified/needs_clarification → approved (locked)
```

**Security Pattern**:
```typescript
interface ResultWithSecurity {
  is_locked?: boolean;        // Prevents edits
  can_edit?: boolean;         // Permission check
  restriction_reason?: string;
}
// Always check can_edit before edit UI
```

**Batch Operations**: Use `ResultVerificationConsole` hook for bulk approve/reject.

## PDF Report & Billing System

### PDF Pipeline: Context → HTML → Browser → Puppeteer → Storage
1. `buildSampleTemplateContext()` - create context in `pdfService.ts`
2. `buildReportHtmlBundle()` or `renderLabTemplateHtmlBundle()` - create HTML bundle
3. `generateAndSavePDFReportWithProgress()` - Puppeteer render
4. `savePDFToStorage()` - Supabase Storage → public URL
5. Distribute: Email/WhatsApp on result approval

**Warmup Puppeteer** (see `App.tsx` line 47-56):
```typescript
useEffect(() => {
  setTimeout(() => warmupPuppeteer().catch(console.warn), 2000);
}, []);
```

### Lab Branding & Signatures
- Stored in `lab_branding_assets` with variants (optimized/original URLs)
- File paths: `attachments/labs/{lab_id}/branding/{asset_type}/{timestamp}_{filename}`
- Signatures: `lab_user_signatures` (digital/handwritten/text types)
- Templates: Nunjucks `{{ variable }}` syntax for dynamic content

### Invoicing & Payments
- **Invoices**: `invoices` + `invoice_items` with discount/tax/payment tracking
- **Payments**: `payments` table tracks method, date, reference
- **Cash Reconciliation**: Daily settlement via `CashReconciliation` page
- **Credit Transactions**: Track credit account per patient

## Build & Development

```bash
npm run dev          # Dev server (http://localhost:5173)
npm run build        # Production build
npm run lint         # ESLint check
npm run preview      # Preview production locally
npm run deploy:prod  # Deploy to Netlify
```

## Component Organization

```
src/components/
├── [Domain]/        # Patients/, Orders/, Results/, Billing/, etc.
├── ui/              # Reusable UI components
├── Layout/          # App shell
├── Workflow/        # Survey.js workflows
├── Masters/         # DoctorMaster, LocationMaster
└── WhatsApp/        # WhatsApp integration
```

**Naming**: Domain-based + suffix (`Modal`, `Console`, `Demo` indicate UI patterns).

## Development Conventions

### Component Structure
```typescript
interface ComponentProps {
  prop1: string;
  onAction?: (data: any) => void;
}

const Component: React.FC<ComponentProps> = ({ prop1, onAction }) => {
  const [state, setState] = useState<Type>(initialValue);
  const handleEvent = () => { /* impl */ };
  return <div>{/* JSX */}</div>;
};

export default Component;
```

### TypeScript Patterns
- Interfaces for all data: `Patient`, `Order`, `Result`
- Union types for status: `'pending' | 'completed' | 'verified'`
- Component props interfaces alongside component

### Error Handling
```typescript
try {
  const { data, error } = await database.orders.create(orderData);
  if (error) throw error;
} catch (error) {
  console.error('Failed:', error);
  // User-friendly message
}
```

### State Management
- Auth: `AuthContext` in `src/contexts/AuthContext.tsx`
- Local: `useState` for component-specific data
- Complex: Custom hooks (`useOrderStatus`, `useVerificationConsole`, `useWhatsAppAutoSync`)

## Business Logic

### Order Management
- Relationships: `orders → order_tests → test_groups → test_group_analytes → analytes`
- Patient-centric: Grouped by `visit_group_id` for multi-visit workflows
- Types: `'primary'` vs `'additional'` tests
- Status: Auto-managed by database triggers

### Order Status Flow (Auto-Managed)
```
Created → In Progress    (sample_collected = true)
       → Pending Approval (all results submitted)
       → Completed       (all results approved)
       → Delivered       (manual: database.orders.markAsDelivered())
```

Sample tracking auto-generated: `sample_id`, `color_code`, `qr_code_data`

### AI Integration
- Attachment processing: `attachments.ai_processed`, `ai_confidence`
- Result extraction: `results.extracted_by_ai`
- AI protocols: `ai_protocols` table for workflow automation
- Gemini API: `src/utils/geminiAI.ts`

### WhatsApp Auto-Sync
- Initialize: `useWhatsAppAutoSync()` hook in `App.tsx`
- Connection: `src/utils/whatsappConnection.ts`
- User sync: `src/utils/whatsappUserSync.ts`
- Messaging: `src/utils/whatsappAPI.ts`
- Delivery: Automatic on result approval

## File Upload & Image Optimization

### Organized File Paths
```typescript
// Auto-organize by category, patient, lab
const filePath = generateFilePath(fileName, patientId, labId, 'reports');
const { path, publicUrl } = await uploadFile(file, filePath);

// Branding: attachments/labs/{lab_id}/branding/{type}/{timestamp}_{filename}
// Signatures: attachments/labs/{lab_id}/users/{userId}/signature/{timestamp}_{filename}
```

### Image Optimization
```typescript
import { smartOptimizeImage, compressImageAdvanced, optimizeBatch } from './utils/imageOptimizer';

const optimized = await smartOptimizeImage(file);  // Auto-compress
const results = await optimizeBatch(files, {
  concurrency: 3,
  minSizeReduction: 0.8  // Prevent overload
});
```

## Key Routes

| Route | Purpose | Safe? |
|-------|---------|-------|
| `/workflow-demo` | Test workflows | ✅ Yes |
| `/workflows` | Map test groups to workflows | ⚠️ Lab-scoped |
| `/visual-form-builder` | Design workflows | ✅ Yes |
| `/results-verification` | Bulk verify results | ⚠️ Final approvals |
| `/orders/:id` | Order + workflow execution | ⚠️ Creates results |
| `/billing` | Invoice + payments | ✅ View, ⚠️ Create |

## Patterns to Follow

1. Lab context filtering
2. Generic attachments: `related_table` + `related_id`
3. Workflow gating: Require valid order + lab
4. Security checks: Verify permissions before modifications
5. Error boundaries with user feedback
6. Tailwind CSS for consistency

## Patterns to Avoid

- ❌ Direct Supabase in components
- ❌ Hard-coded lab IDs
- ❌ Bypassing verification workflow
- ❌ Creating new workflow/report systems
- ❌ Test mapping without lab filtering
- ❌ Missing `test_code` in mappings
- ❌ File paths without `generateFilePath()` helper

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/utils/supabase.ts` | Central database API (6400+ lines) |
| `src/contexts/AuthContext.tsx` | Auth state & user context |
| `src/utils/pdfService.ts` | PDF generation, Puppeteer, templating |
| `src/utils/workflowAPI.ts` | Workflow CRUD |
| `src/utils/whatsappAPI.ts` | WhatsApp messaging |
| `src/components/Workflow/FlowManager.tsx` | Multi-workflow orchestration |
| `src/pages/WorkflowManagement.tsx` | Test group → workflow mapping UI |
| `src/types/index.ts` | Core TypeScript definitions |
