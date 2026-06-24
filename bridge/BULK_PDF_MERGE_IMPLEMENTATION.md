# LIMS Bridge: Bulk PDF Merge Implementation

## Overview

The LIMS web app can now queue `bulk_pdf_merge` jobs to the `print_jobs` table. The Bridge needs to poll for these jobs, download all PDFs locally, merge them into a single file, and save to the user's computer.

## Job Schema

When polling `/print-bridge/pending`, jobs with `printer_role === 'bulk_pdf_merge'` will have this payload structure:

```typescript
interface BulkPdfMergePayload {
  pdf_list: Array<{
    order_id: string;
    sample_id: string | null;
    patient_name: string;
    order_number: number | null;
    order_date: string | null;
    pdf_url: string;  // Supabase storage signed URL
  }>;
  sort_mode: 'sample_desc' | 'sample_asc' | 'order_id_asc' | 'order_id_desc' | 'date_desc' | 'patient_az';
  output_filename: string;  // e.g. "bulk_reports_2026-06-16T14-30-00.pdf"
  save_to_folder: string | null;  // optional path hint, null = use default
  total_count: number;
}
```

## Implementation Steps

### 1. Add Dependencies

```bash
npm install pdf-lib
```

### 2. Add Bulk Merge Handler

Create a new file `src/bulkPdfMerge.ts`:

```typescript
import { PDFDocument } from 'pdf-lib';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { shell } from 'electron'; // or use 'open' package for non-Electron

interface BulkPdfItem {
  order_id: string;
  sample_id: string | null;
  patient_name: string;
  order_number: number | null;
  order_date: string | null;
  pdf_url: string;
}

interface BulkPdfMergePayload {
  pdf_list: BulkPdfItem[];
  sort_mode: string;
  output_filename: string;
  save_to_folder: string | null;
  total_count: number;
}

function getDefaultDownloadFolder(): string {
  // Use user's Downloads folder or a LIMS-specific folder
  const downloads = path.join(os.homedir(), 'Downloads', 'LIMS Reports');
  return downloads;
}

export async function processBulkPdfMerge(
  jobId: string,
  payload: BulkPdfMergePayload,
  onProgress?: (downloaded: number, total: number) => void
): Promise<{ success: boolean; outputPath?: string; error?: string; mergedCount?: number }> {
  const { pdf_list, output_filename, save_to_folder } = payload;
  
  if (!pdf_list || pdf_list.length === 0) {
    return { success: false, error: 'No PDFs in list' };
  }

  // Create temp directory for downloads
  const tempDir = path.join(os.tmpdir(), `lims_bulk_merge_${jobId}`);
  await fs.mkdir(tempDir, { recursive: true });

  const downloadedPaths: string[] = [];
  let downloadErrors = 0;

  try {
    // Download all PDFs
    for (let i = 0; i < pdf_list.length; i++) {
      const item = pdf_list[i];
      const pdfPath = path.join(tempDir, `${i.toString().padStart(4, '0')}_${item.order_id}.pdf`);

      try {
        const response = await fetch(item.pdf_url);
        if (!response.ok) {
          console.error(`Failed to download PDF for order ${item.order_id}: ${response.status}`);
          downloadErrors++;
          continue;
        }

        const buffer = await response.arrayBuffer();
        await fs.writeFile(pdfPath, Buffer.from(buffer));
        downloadedPaths.push(pdfPath);

        if (onProgress) {
          onProgress(i + 1, pdf_list.length);
        }
      } catch (err) {
        console.error(`Error downloading PDF for order ${item.order_id}:`, err);
        downloadErrors++;
      }
    }

    if (downloadedPaths.length === 0) {
      return { success: false, error: 'No PDFs could be downloaded' };
    }

    // Merge PDFs using pdf-lib
    const mergedPdf = await PDFDocument.create();

    for (const pdfPath of downloadedPaths) {
      try {
        const pdfBytes = await fs.readFile(pdfPath);
        const srcDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        const pages = await mergedPdf.copyPages(srcDoc, srcDoc.getPageIndices());
        pages.forEach(page => mergedPdf.addPage(page));
      } catch (err) {
        console.error(`Error merging PDF ${pdfPath}:`, err);
      }
    }

    // Determine output folder
    const outputDir = save_to_folder || getDefaultDownloadFolder();
    await fs.mkdir(outputDir, { recursive: true });

    const outputPath = path.join(outputDir, output_filename);
    const mergedBytes = await mergedPdf.save();
    await fs.writeFile(outputPath, mergedBytes);

    // Clean up temp files
    await fs.rm(tempDir, { recursive: true, force: true });

    // Open folder in file explorer (optional)
    try {
      if (typeof shell !== 'undefined' && shell.showItemInFolder) {
        shell.showItemInFolder(outputPath);
      }
    } catch {
      // Ignore if shell not available
    }

    return {
      success: true,
      outputPath,
      mergedCount: downloadedPaths.length,
    };

  } catch (err) {
    // Clean up on error
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {}

    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
```

### 3. Update Main Polling Loop

In your main `index.ts`, add handling for bulk_pdf_merge jobs:

```typescript
import { processBulkPdfMerge } from './bulkPdfMerge';

// In your job processing loop:
async function processJob(job: PrintJob) {
  if (job.printer_role === 'bulk_pdf_merge') {
    console.log(`[Bridge] Processing bulk PDF merge job ${job.id}`);
    
    const result = await processBulkPdfMerge(
      job.id,
      job.payload,
      (downloaded, total) => {
        console.log(`[Bridge] Download progress: ${downloaded}/${total}`);
        // Optional: update job payload with progress
      }
    );

    // ACK the job
    await ackJob(job.id, {
      success: result.success,
      error: result.error,
      output_path: result.outputPath,
      merged_count: result.mergedCount,
    });

    if (result.success) {
      console.log(`[Bridge] Merged ${result.mergedCount} PDFs to ${result.outputPath}`);
    } else {
      console.error(`[Bridge] Bulk merge failed: ${result.error}`);
    }

    return;
  }

  // ... existing print job handling
}
```

### 4. ACK Function

Make sure your ack function sends the result back:

```typescript
async function ackJob(jobId: string, result: {
  success: boolean;
  error?: string;
  output_path?: string;
  merged_count?: number;
}) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/print-bridge/ack`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-lab-api-key': API_KEY,
    },
    body: JSON.stringify({
      job_id: jobId,
      success: result.success,
      error: result.error || null,
      append_payload_metadata: true,
      payload: {
        output_path: result.output_path,
        merged_count: result.merged_count,
        completed_at: new Date().toISOString(),
      },
    }),
  });

  if (!response.ok) {
    console.error(`Failed to ACK job ${jobId}: ${response.status}`);
  }
}
```

## Testing

1. In the LIMS web app, go to Corporate Bulk > Account Orders
2. Select some orders with generated print reports
3. Click "Bridge Merge" button
4. Check Bridge console for download/merge progress
5. Merged PDF should appear in Downloads/LIMS Reports folder

## Configuration (Optional)

Add to your Bridge `.env`:

```env
# Default folder for bulk PDF downloads (optional)
BULK_PDF_DOWNLOAD_FOLDER=C:\Users\YourUser\Documents\LIMS Bulk Reports
```

## Error Handling

- If some PDFs fail to download, continue with the rest
- Log errors but don't fail the entire job unless 0 PDFs succeed
- Report partial success in ACK (e.g., "merged 45/50 PDFs")

## Performance Notes

- PDFs are downloaded sequentially to avoid overwhelming the network
- For very large batches (100+ PDFs), consider adding a small delay between downloads
- The merge operation uses pdf-lib which is efficient for combining PDFs
- Temp files are cleaned up after merge completes
