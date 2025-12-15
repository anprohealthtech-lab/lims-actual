# LIMS v2 - AI Copilot Instructions

## Project Overview

This is a Laboratory Information Management System (LIMS) v2 built with **React/TypeScript + Vite**, featuring multi-lab support, AI-powered workflows, and mobile capabilities via **Capacitor**.

**Key Stack**:
- **Frontend**: React 18.3, TypeScript, Vite, Tailwind CSS
- **Mobile**: Capacitor 7 (Android)
- **Backend**: Supabase (PostgreSQL, Auth, Storage, Edge Functions)
- **PDF Service**: Dedicated Node.js Puppeteer service (`/puppeteer-service`)
- **Workflows**: Survey.js 1.9.x
- **Email**: React Email
- **Editor**: CKEditor 5

## Core Data Access Layer

**CRITICAL: Always use the centralized API in `src/utils/supabase.ts`**

Do NOT use `supabase.from(...)` directly in components. Use the `database` object which handles error handling, lab-scoped filtering, and business logic.

```typescript
// ❌ Wrong
const { data } = await supabase.from('orders').select('*');

// ✅ Correct
const { data, error } = await database.orders.getAll();
const lab_id = await database.getCurrentUserLabId();
```

The `database` object exports namespaces: `patients`, `orders`, `results`, `invoices`, `payments`, `labs`, `users`, `doctors`, `locations`, `testWorkflowMap`, `workflows`, `workflowVersions`, `aiProtocols`.

## Multi-Lab Architecture

**Every operation must respect lab boundaries:**
- Users belong to ONE lab (`users.lab_id`).
- All queries must filter by lab context.
- `lab_analytes` overrides global `analytes`.
- Test group mappings are lab-scoped.

```typescript
const lab_id = await database.getCurrentUserLabId();
if (!lab_id) throw new Error('No lab context');
```

## Workflow System (Survey.js)

- **FlowManager** (`src/components/Workflow/FlowManager.tsx`): Orchestrates multi-step workflows.
- **WorkflowRunner**: Executes Survey.js forms and saves results.
- **Data Flow**: Survey.js Form → WorkflowRunner → `database.results.create()`.
- **Rules**: Workflows are lab-scoped and order-gated.
- **Visual Form Builder**: Located at `/visual-form-builder`, uses SurveyJS Creator.

## PDF Report Generation

PDF generation is handled by a dedicated **Puppeteer Service** (`/puppeteer-service`) for performance and reliability.

1. **Context Creation**: `buildSampleTemplateContext()` in `src/utils/pdfService.ts`.
2. **HTML Generation**: `buildReportHtmlBundle()`.
3. **Rendering**: Calls the Puppeteer Service API (`/generate-pdf`).
4. **Storage**: Saves to Supabase Storage.

**Puppeteer Service**:
- Located in `puppeteer-service/`.
- Node.js/Express app.
- Deployed separately (e.g., DigitalOcean App Platform).
- API: `POST /generate-pdf`, `POST /warmup`.

## Mobile Development (Capacitor)

The project is mobile-enabled using Capacitor for Android.

- **Sync**: `npm run android:sync` (copies build to `android/`).
- **Run**: `npm run android:run` (runs on connected device/emulator).
- **Open IDE**: `npm run android:open` (opens Android Studio).
- **Camera**: Uses `@capacitor/camera` for file uploads in workflows.

## Component Organization

- `src/components/[Domain]/`: Domain-specific components (Patients, Orders, Results).
- `src/components/ui/`: Reusable UI components.
- `src/components/Workflow/`: Survey.js integration.
- `src/emails/`: React Email templates (`PatientReportEmail.tsx`, `B2BInvoiceEmail.tsx`).
- `src/utils/supabase.ts`: **Centralized Database API** (Monolithic file).

## Development Conventions

- **Interfaces**: Define interfaces for all data models (Patient, Order, Result).
- **Error Handling**: Use the `database` object's returned `error` property.
- **State**: Use `AuthContext` for user/lab context.
- **File Uploads**: Use `generateFilePath()` helper for organized storage paths.
- **Images**: Use `src/utils/imageOptimizer.ts` for compression before upload.

## Key Files

- `src/utils/supabase.ts`: The "Brain" of the application (Data Access).
- `src/utils/pdfService.ts`: PDF generation logic.
- `puppeteer-service/server.js`: PDF rendering service entry point.
- `src/components/Workflow/FlowManager.tsx`: Workflow orchestration.
- `src/contexts/AuthContext.tsx`: Auth & Lab context.
