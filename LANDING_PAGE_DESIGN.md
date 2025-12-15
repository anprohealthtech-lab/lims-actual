# LIMS v2 Landing Page Design & Content Strategy

This document outlines the structure, copy, and visual assets required to build a high-converting landing page for LIMS v2. It focuses on the unique AI capabilities and workflow integrations.

## 1. Hero Section: The AI-Powered Lab
**Goal:** Immediately establish the system as a next-gen, AI-first solution.

*   **Headline:** The Intelligent Brain for Modern Pathology Labs.
*   **Subheadline:** From handwritten TRFs to verified reports in seconds. Automate workflows, read instrument screens via AI, and deliver results directly to WhatsApp.
*   **CTA:** Request Demo / Start Free Trial
*   **Visual Concept:** A split view showing "Old Way" (Paper stacks, manual entry) vs "New Way" (Sleek dashboard, AI scanning).
*   **Image Generation Prompt:**
    > *Photorealistic, high-tech medical laboratory environment. In the foreground, a sleek glass tablet displays a futuristic LIMS dashboard with glowing blue accents. In the background, a blurred automated analyzer. The lighting is clean, clinical white and soft blue. 8k resolution, unreal engine 5 render style.*

---

## 2. The Command Center (Dashboard)
**Goal:** Show operational control and visibility.

*   **Headline:** Your Entire Lab Operation. One Screen.
*   **Copy:** Monitor sample transit, pending verifications, revenue, and phlebotomist tracking in real-time.
*   **Key Features:**
    *   Live Sample Tracking (Collection -> Transit -> Processing)
    *   Financial Overview
    *   Pending Action Items
*   **Image Generation Prompt:**
    > *UI design mockup of a comprehensive medical software dashboard. Dark mode and Light mode split. Widgets displaying "Samples in Transit", "Daily Revenue", and "Pending Verifications". Data visualization with smooth line charts and donut charts. Clean sans-serif typography. High fidelity UI design.*

---

## 3. AI-Powered Data Entry (TRF Extraction)
**Goal:** Highlight the "Zero Data Entry" feature.

*   **Headline:** Stop Typing. Start Scanning.
*   **Copy:** Upload a photo of any handwritten Test Request Form (TRF). Our AI instantly extracts patient demographics and test requests, creating the order automatically with 99% accuracy.
*   **Visual Concept:** A transformation animation or static image showing a handwritten paper form turning into structured digital data.
*   **Image Generation Prompt:**
    > *Split screen composition. Left side: A slightly crumpled, handwritten medical test request form with doctor's scribbles. Right side: A clean, digital web form with the same data perfectly populated. A glowing, digital scanning beam connects the two sides. Cybernetic data particles floating in the air.*

---

## 4. Universal Instrument Connectivity (AI Screen Reader)
**Goal:** Showcase the unique "Vision" capability for non-connected instruments.

*   **Headline:** Connect Any Instrument. No Cables Required.
*   **Copy:** Don't have HL7? No problem. Just point a camera at your analyzer's screen. Our AI reads the results, interprets the values, and maps them directly to the patient's report.
*   **Visual Concept:** A smartphone capturing an older medical device screen, with AR overlays highlighting the numbers.
*   **Image Generation Prompt:**
    > *Close-up of a smartphone camera pointed at the LCD screen of a hematology analyzer. The phone screen displays an Augmented Reality (AR) overlay, drawing green bounding boxes around the numeric test results on the analyzer's screen. Digital connection lines flow from the phone to a cloud icon.*

---

## 5. Rapid Test Analysis (AI Vision)
**Goal:** Demonstrate standardization of rapid card tests.

*   **Headline:** Objective Analysis for Rapid Tests.
*   **Copy:** Eliminate subjective reading of Dengue, Malaria, or Urine strips. AI analyzes the band intensity, determines Positive/Negative status, and attaches the image proof to the final report.
*   **Visual Concept:** A lateral flow cassette with a digital "scan" overlay indicating the result.
*   **Image Generation Prompt:**
    > *Macro shot of a lateral flow rapid test cassette (like a Covid or Malaria test) sitting on a lab bench. A digital holographic overlay is analyzing the red test lines. A floating UI tag next to it reads "Result: Positive (Confidence 98%)". Clean medical aesthetic.*

---

## 6. Order Management & Details
**Goal:** Show depth of functionality.

*   **Headline:** Complete Patient Context.
*   **Copy:** Manage everything from a single modal. View patient history, edit demographics, track sample status, and manage billing without leaving the screen.
*   **Visual Concept:** The "Order Details Modal" floating over the main interface.
*   **Image Generation Prompt:**
    > *High-quality UI screenshot of a complex modal window titled "Order #12345". The modal contains sections for "Patient Info", "Test List", "Billing Status", and "Sample Timeline". Glassmorphism background effect. The design is clean, organized, and user-friendly.*

---

## 7. Result Verification & Reporting
**Goal:** Emphasize speed and accuracy in the final stage.

*   **Headline:** Verify with Confidence. Report with Speed.
*   **Copy:** Auto-flag abnormal values based on age/gender. One-click verification adds digital signatures and generates a branded PDF report.
*   **Visual Concept:** A doctor reviewing a report on a tablet, with a "Verified" stamp appearing.
*   **Image Generation Prompt:**
    > *A doctor's hand holding a tablet displaying a digital pathology report. Abnormal values are highlighted in soft orange. A digital "Verified" stamp animation is visible on the screen. In the background, a blurred modern office setting.*

---

## 8. WhatsApp Integration
**Goal:** Show the patient-facing convenience.

*   **Headline:** Deliver Results Where Your Patients Are.
*   **Copy:** Automatically send PDF reports, invoices, and status updates directly to patient and doctor WhatsApp accounts. No more printing or emailing.
*   **Visual Concept:** A smartphone showing a WhatsApp chat with the lab.
*   **Image Generation Prompt:**
    > *A realistic smartphone mockup showing a WhatsApp chat interface. The contact name is "City Pathology Lab". The chat shows a "Welcome" message, followed by a PDF attachment named "Lab_Report.pdf" and a "Download" button. Green checkmarks indicate read status.*

---

## 9. Technical & Sidebar Navigation
**Goal:** Show the breadth of the application structure.

*   **Headline:** Built for Scale.
*   **Copy:** Navigate effortlessly between departments. Multi-lab support, role-based access control, and secure cloud storage included.
*   **Visual Concept:** A focus on the sidebar navigation menu showing the various modules.
*   **Image Generation Prompt:**
    > *Close-up UI detail of a vertical sidebar navigation menu. Icons for "Dashboard", "Accession", "Verification", "Finance", "Inventory", and "Settings". The "Dashboard" icon is active and glowing blue. Dark theme UI.*

---

## 10. Detailed Feature Breakdown by Page
**Use these lists to populate the "Features" section of your landing page or for detailed product tour tooltips.**

### 📊 Dashboard (`/dashboard`)
*   **Live Stats:** Real-time counters for Revenue, New Orders, Pending Reports, and Critical Alerts.
*   **Sample Transit Widget:** Track samples moving between collection centers and the main lab (Pending Dispatch -> In Transit -> Received).
*   **Phlebotomist Tracking:** Monitor active field staff and sample collections.
*   **Quick Actions:** One-click access to "New Order", "Register Patient", and "Upload TRF".
*   **Status Filters:** Filter orders by "Pending Approval", "In Progress", or "Completed".

### 📝 Accession / Order Entry (`/orders`)
*   **Smart Patient Search:** Auto-complete patient details by phone number or name.
*   **Test Catalog:** Searchable database of individual tests and profiles (e.g., "Lipid Profile").
*   **Barcode Generation:** Auto-generate unique sample IDs and barcodes upon order creation.
*   **B2B/Outsourcing:** Tag orders for outsourced labs and track their status separately.
*   **TRF Upload:** Attach photos of physical prescription forms directly to the digital order.

### 🔬 Result Verification Console (`/verification`)
*   **Delta Checks:** Automatically compare current results with the patient's previous history.
*   **Reference Ranges:** Visual flags (High/Low/Critical) based on patient age and gender.
*   **Bulk Approval:** Select multiple normal reports and approve them in one click.
*   **Digital Signatures:** Auto-append the verifying doctor's signature to the final PDF.
*   **Audit Trail:** Track who entered, modified, and approved every single result value.

### 💰 Finance & Billing (`/billing`)
*   **Invoice Generation:** Create professional B2B and B2C invoices with QR codes.
*   **Payment Tracking:** Record cash, UPI, and card payments. Track partial payments and dues.
*   **Cash Reconciliation:** End-of-day reports for cashiers to tally physical cash with system records.
*   **Refund Management:** Process refunds with approval workflows.

### ⚙️ Settings & Configuration (`/settings`)
*   **Lab Branding:** Upload logos, headers, and footers for reports.
*   **User Management:** Create accounts for Pathologists, Technicians, and Phlebotomists with specific roles.
*   **Test Master:** Configure normal values, units, and prices for thousands of tests.
*   **WhatsApp Templates:** Customize the automated messages sent to patients (Welcome, Report Ready, Bill).

### 🤖 AI Tools Suite (`/ai-tools`)
*   **TRF Extractor:** Convert handwritten forms to digital orders.
*   **Instrument Vision:** Read values from non-connected analyzer screens using a camera.
*   **Rapid Reader:** Standardize interpretation of lateral flow assays (Rapid Cards).

---

## 11. Core Modules Deep Dive
**Expanded descriptions for the "Core Modules" section of the landing page, focusing on operational benefits.**

### 🏥 Smart Accession (Front Desk)
*   **The Problem:** Long queues and data entry errors at reception.
*   **The Solution:** A lightning-fast registration module designed for high-volume labs.
*   **Key Capability:** **Predictive Patient Search**. As you type a phone number, the system pulls up the patient's entire history, auto-filling demographics and flagging unpaid dues.
*   **Benefit:** Reduces registration time by 60% and eliminates duplicate patient records.

### 🧪 Laboratory Operations (The Engine)
*   **The Problem:** Losing track of samples and delayed turnaround times (TAT).
*   **The Solution:** End-to-end sample lifecycle tracking with visual cues.
*   **Key Capability:** **Color-Coded Status Workflow**. Every sample has a live status (Collected 🟡 -> In Transit 🚚 -> Processing ⚙️ -> Verified ✅).
*   **Benefit:** Lab managers can instantly spot bottlenecks. If a sample is stuck in "Processing" for too long, it gets flagged.

### 💳 Financial Management (Billing)
*   **The Problem:** Revenue leakage and complex B2B settlements.
*   **The Solution:** An integrated billing system that locks reports until payment (optional).
*   **Key Capability:** **Multi-Tier Rate Lists**. Automatically apply different prices for Walk-in patients, B2B partners, and Insurance/Corporate clients.
*   **Benefit:** Ensures 100% revenue capture. Daily Cash Reconciliation reports prevent theft and mismanagement at the counter.

### 📄 Reporting & Delivery (Patient Experience)
*   **The Problem:** Patients calling repeatedly for reports; unreadable formats.
*   **The Solution:** Automated, multi-channel delivery of professional reports.
*   **Key Capability:** **Smart PDF Generation**. Reports include historical trend graphs for thyroid/diabetes, QR codes for verification, and dynamic comments based on result values.
*   **Benefit:** Reduces front-desk inquiries by 80%. Patients receive reports on WhatsApp the moment they are verified.

### 🎨 Advanced Report Templating (Customization)
*   **The Problem:** Rigid report formats that require a developer to change.
*   **The Solution:** A powerful WYSIWYG editor (CKEditor) allowing complete design freedom.
*   **Key Capability:** **Dynamic Template Engine**. Create distinct layouts for Pathology, Radiology, and Histopathology. Drag-and-drop headers, footers, and digital signatures.
*   **Benefit:** Professional, branded reports that look exactly how you want them, building trust with referring doctors.

### 🔄 Workflow Automation Engine (Compliance)
*   **The Problem:** Complex tests (like Biopsies or Cultures) involve multiple steps that simple LIMS cannot track.
*   **The Solution:** A configurable workflow system (powered by SurveyJS) that enforces Standard Operating Procedures (SOPs).
*   **Key Capability:** **Protocol Enforcement**. Define mandatory checklists for each stage (e.g., Grossing -> Processing -> Staining -> Reporting).
*   **Benefit:** Ensures 100% compliance for NABL/CAP accreditation and reduces technical errors.

### 🤝 B2B & Outsourcing Portal (Growth)
*   **The Problem:** Managing samples sent to reference labs and tracking B2B payments is chaotic.
*   **The Solution:** A dedicated module for managing external relationships.
*   **Key Capability:** **Bi-Directional Sync**. Automatically dispatch samples to reference labs and pull results back. Manage credit limits and monthly billing for collection centers.
*   **Benefit:** Scale your business by becoming a reference lab for others, or seamlessly outsourcing specialized tests.

### 📱 Mobile Phlebotomy App (Logistics)
*   **The Problem:** Home collections are often unorganized, leading to missed appointments and lost samples.
*   **The Solution:** A dedicated Android app for field staff.
*   **Key Capability:** **Live Field Management**. Assign visits, track phlebotomists via GPS, and capture digital consent/signatures at the patient's doorstep.
*   **Benefit:** "Uber-like" experience for patients and complete visibility for the lab manager.

---

## 12. Why Choose LIMS v2? (The Competitive Edge)
**Summary of the unique value proposition.**

1.  **AI-First Core:** Not just a database, but an intelligent assistant that reads forms and screens.
2.  **Zero-Code Customization:** Edit report templates and workflows without hiring a programmer.
3.  **Hybrid Architecture:** Works for single labs, multi-center chains, and B2B networks.
4.  **Patient-Centric:** WhatsApp integration and smart reports put the patient experience first.



