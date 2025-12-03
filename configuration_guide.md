# Configuration Guide for Outsourced Management & Email Services

This guide details the external services, environment variables, and user actions required to fully enable the Outsourced Management features and Email Sending capabilities.

## 1. External Services Overview

You need to configure the following services.

| Feature | Service | Website | Variable Name |
| :--- | :--- | :--- | :--- |
| **Email Sending** | **Resend** | [resend.com](https://resend.com) | `RESEND_API_KEY` |
| **Email Receiving** | **Postmark** | [postmarkapp.com](https://postmarkapp.com) | `POSTMARK_SERVER_TOKEN` |
| **PDF Merging** | **PDF.co** | [pdf.co](https://pdf.co) | `PDFCO_API_KEY` |
| **AI Extraction** | **Google Gemini** | [ai.google.dev](https://ai.google.dev) | `GEMINI_API_KEY` |
| **Database** | **Supabase** | [supabase.com](https://supabase.com) | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |

---

## 2. Detailed Setup: Email Sending (Resend)

This service is used to send **Patient Reports** and **B2B Invoices**.

### Step A: Create Account & Get API Key
1.  Go to [Resend.com](https://resend.com) and **Sign Up**.
2.  Once logged in, go to **API Keys** in the sidebar.
3.  Click **Create API Key**.
4.  Name it (e.g., "LIMS Prod") and give it **Full Access** (or Sending access).
5.  **Copy the API Key** (starts with `re_...`). You will need this for Netlify.

### Step B: Verify Domain (Crucial for Production)
*Without this, you can only send emails to the email address you signed up with (Testing Mode).*
1.  Go to **Domains** in Resend.
2.  Click **Add Domain**.
3.  Enter your domain (e.g., `reports.yourlab.com`).
4.  Resend will provide **DNS records** (TXT, CNAME, MX).
5.  Log in to your **DNS Provider** (GoDaddy, Namecheap, Cloudflare, etc.).
6.  Add the records provided by Resend.
7.  Wait for verification (usually minutes, up to 24h).

### Step C: Configure Environment Variable
1.  Go to your **Netlify Dashboard**.
2.  Select your site.
3.  Go to **Site configuration > Environment variables**.
4.  Add a new variable:
    - **Key**: `RESEND_API_KEY`
    - **Value**: (Paste the key from Step A)

### Step D: Update Code (If using Custom Domain)
By default, the code sends from `reports@resend.dev`. Once your domain is verified:
1.  Open `netlify/functions/send-email.ts`.
2.  Find line 59: `from: 'LIMS Reports <reports@resend.dev>'`.
3.  Change it to your verified domain: `from: 'LIMS Reports <no-reply@reports.yourlab.com>'`.

---

## 3. Detailed Setup: Email Receiving (Postmark)

This service is used to **receive reports** from outsourced labs.

1.  **Log in to Postmark** and create a **Server**.
2.  Go to **Settings > Inbound Webhook**.
3.  Set **Webhook URL**: `https://<your-site-name>.netlify.app/.netlify/functions/receive-report`
4.  Check **"Include raw content"**.
5.  **Save**.
6.  Note your inbound email address (e.g., `your-hash@inbound.postmarkapp.com`). You will auto-forward lab emails to this address.

---

## 4. Detailed Setup: PDF Merging (PDF.co)

This service is used to **merge** the original LIMS report with the outsourced lab's PDF.

1.  **Sign Up** at [PDF.co](https://pdf.co).
2.  Go to **Dashboard** to find your **API Key**.
3.  Add to Netlify Environment Variables:
    - **Key**: `PDFCO_API_KEY`
    - **Value**: (Your API Key)

---

## 5. Detailed Setup: AI Extraction (Google Gemini)

This service extracts data from the outsourced PDF reports.

1.  **Get API Key** from [Google AI Studio](https://aistudio.google.com/app/apikey).
2.  Add to Netlify Environment Variables:
    - **Key**: `GEMINI_API_KEY`
    - **Value**: (Your API Key)

---

## 6. DigitalOcean Agent (LIMS Agent)

1.  **Deploy Agent** on DigitalOcean GenAI Platform.
2.  **Copy Endpoint URL**.
3.  In the LIMS App: **AI Tools > LIMS Agent > Settings**.
4.  Paste the URL and Save.

---

## 7. User / Admin Actions (What you need to do in the App)

### For Each Outsourced Lab:
1.  **Settings > Outsourced Labs**: Add the lab details.
2.  **Important**: The `Email` field should match the address they send reports FROM.

### For Each Test:
1.  **Tests > Edit Test Group**:
2.  Check **"Is Outsourced?"**.
3.  Select the **Default Outsourced Lab**.

### For Sending Emails (Patients/Clients):
- The system uses the API automatically when you trigger "Send Report" or "Send Invoice" actions.
- **Sender Identity ("On Behalf Of")**:
  - Emails are sent from your verified platform domain (e.g., `reports@yourlab.com`).
  - The **"From Name"** is dynamically set to the **Lab's Name** (e.g., "City Path Labs").
  - The **"Reply-To"** is set to the **Lab's Email**, so if a patient replies, it goes directly to the lab.
  - *No configuration needed per user* other than ensuring their Lab Settings are correct.
- **Per User**: No specific action needed for each patient/client other than having a valid email address in their profile.

---

## 8. User Guide: Setting up Auto-Forwarding (Receiving Reports)

To receive reports automatically, you (or the Lab Admin) need to set up **Auto-Forwarding** from your main lab email (e.g., `lab@gmail.com`) to the **Postmark Inbound Address** (e.g., `hash@inbound.postmarkapp.com`).

### Is it tricky?
It has one "tricky" step: **Verification**.
Most providers (like Gmail) verify that you own the destination address by sending a **Verification Code** to it. Since the destination is our system (not a real inbox), you need to retrieve this code.

### Step-by-Step (Gmail Example):

1.  **Add Forwarding Address**:
    - Go to Gmail Settings > **Forwarding and POP/IMAP**.
    - Click **Add a forwarding address**.
    - Enter your **Postmark Inbound Address**.
    - Click **Next** > **Proceed**.

2.  **Get the Verification Code**:
    - Gmail will say: *"A confirmation code has been sent to..."*
    - **Problem**: You can't log in to that inbox.
    - **Solution**:
        - Go to your **Postmark Dashboard** > **Activity**.
        - Look for the email from "Gmail Team".
        - Open it to find the **Confirmation Code**.
        - *Alternatively*: Check the `outsourced_reports` table in Supabase; the verification email might be logged there as a "failed" or "processed" entry depending on your logic.

3.  **Verify & Enable**:
    - Go back to Gmail Settings.
    - Enter the code and click **Verify**.
    - Select **"Forward a copy of incoming mail to..."**.
    - **Tip**: You can create a **Filter** to only forward emails with attachments or from specific labs, instead of forwarding *everything*.

