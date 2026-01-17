# Machine Interface: Master Execution Plan (AI-First + Bidirectional)

**Version:** 3.0 (Final Execution Strategy)
**Date:** January 17, 2026
**Architecture:** "AI-First" using One Universal Gateway + Supabase RAG.

---

## 1. Executive Summary

This plan integrates the **AI-First Parsing** (for results) and **Bidirectional Querying** (for orders) into a single, unified system. 

**The Workflow:**
1.  **Technician** scans barcode on Analyzer.
2.  **Analyzer** asks Gateway: *"Who is barcode 12345?"*
3.  **Gateway** checks Supabase: *"It's John Doe, needs CBC."*
4.  **Analyzer** runs test & sends results to Gateway.
5.  **Gateway** sends raw text to Supabase AI.
6.  **AI Agent** parses, maps, and files the result to the Patient's file.

---

## 2. Architecture: "The One Utility"

We will build **ONE** lightweight software agent ("LIMS Bridge") to be installed on the lab computer.

```
[ Lab Analyzer ]  <--Serial/TCP-->  [ LIMS Bridge (Node.js) ]  <--HTTPS-->  [ Supabase Cloud ]
(Sysmex/Roche)                         (Local Service)                       (Database + AI)
```

-   **LIMS Bridge**: Dumb pipe. Relays text. Handles real-time Query/Response locally for speed (optional) or proxies it to Cloud.
-   **Supabase Cloud**: The Brain. Stores data, runs AI, holds the Order info.

---

## 3. Implementation Steps

### Phase 1: Database Foundation (Day 1-2)
**Goal:** Create the tables to store raw messages and AI knowledge.

*   **Action:** Run SQL Migration to create:
    1.  `analyzer_raw_messages`: The inbox for all machine data.
    2.  `analyzer_knowledge`: The RAG brain (stores past successful mappings).
    3.  `analyzer_connections`: Config for each machine (IP, Port, Protocol).

### Phase 2: The "LIMS Bridge" Utility (Day 3-5)
**Goal:** Build the installable local program.

*   **Technology:** Node.js (packaged as an `.exe`).
*   **Features:**
    1.  **Config UI:** Enter Supabase URL + Lab ID + Machine IP.
    2.  **Listener:** Opens TCP Port or watches Serial Port.
    3.  **Forwarder:** Sends any received text to `analyzer_raw_messages`.
    4.  **Query Handler (Bidirectional):**
        *   If message is a "Query" (e.g., `Q|1|^12345...`), it immediately calls Supabase RPC `get_pending_order('12345')`.
        *   Constructs the machine-specific "Order" string (e.g., `O|1|12345|...`) and sends it back to the analyzer.

### Phase 3: The AI Agent (Edge Function) (Day 6-8)
**Goal:** The intelligent parsing engine.

*   **Technology:** Supabase Edge Function (Deno) + Gemini 1.5 Flash.
*   **Trigger:** Runs whenever a new row is added to `analyzer_raw_messages`.
*   **Logic:**
    1.  Fetch RAG context (similar past messages).
    2.  Prompt Gemini: *"Here is a raw medical string. Parse it into JSON. Map 'WBC-X' to our standard 'White Blood Cell'."*
    3.  Insert validated data into `results` table.

### Phase 4: Dashboard Integration (Day 9-10)
**Goal:** Visibility for the user.

*   **UI:** Add "Analyzers" tab to Dashboard.
*   **Features:**
    *   **Live Feed:** Show incoming messages scrolling (like a terminal).
    *   **Connection Status:** Green/Red dot for the LIMS Bridge connection.
    *   **Review Queue:** Any AI result with <80% confidence waits here for human click-to-approve.

---

## 4. Detailed Technical Specifications

### A. Database Schema (Target)
```sql
CREATE TABLE analyzer_raw_messages (
    id uuid PRIMARY KEY,
    lab_id uuid,
    raw_content text,           -- The full HL7/ASTM string
    direction text,             -- 'INBOUND' (Result) or 'OUTBOUND' (Order)
    ai_status text,             -- 'pending', 'processed', 'review_needed'
    ai_confidence float,
    sample_barcode text         -- Extracted by AI
);
```

### B. The Bi-Directional Logic (The "Query")
*Standard ASTM "Query" Flow:*
1.  **Analyzer:** `Q|1|^sample_id||ALL||||||||O`
2.  **Bridge:** Parses `sample_id`.
3.  **Bridge:** Calls `await supabase.rpc('fetch_order', { barcode: sample_id })`.
4.  **Supabase:** Returns `{ patient: "John", tests: ["CBC", "Lipid"] }`.
5.  **Bridge:** Generates:
    ```
    H|\^&|||LIMS|||||||P|1
    P|1|||123||John Doe
    O|1|sample_id||^^^CBC\^^^LIPID|R
    L|1|N
    ```
6.  **Analyzer:** Receives Order, Starts Run.

---

## 5. Deployment Strategy
1.  **Cloud First:** Deploy Database tables and Edge Functions.
2.  **Pilot:** Install "LIMS Bridge" on **one** machine in your lab (e.g., the Hematology Analyzer).
3.  **Train AI:** Feed it 1 day of results. Manually correct the first few. Watch it learn.
4.  **Full Rollout:** Copy the Bridge .exe to other machines.

---
**Next Step for User:** Approve this plan, and I will generate the **Phase 1 SQL Migration** to begin.
