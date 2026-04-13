/**
 * QZ Tray Context
 * Provides app-wide QZ Tray connection state and auto-print helpers.
 *
 * Settings resolution (location overrides lab):
 *   barcodePrinterName     = location.barcode_printer_name     ?? lab.barcode_printer_name
 *   reportPrinterName      = location.report_printer_name      ?? lab.report_printer_name
 *   autoPrintBarcodeOnOrder = location.auto_print_barcode_on_order ?? lab.auto_print_barcode_on_order
 *   autoPrintReportOnApproval = location.auto_print_report_on_approval ?? lab.auto_print_report_on_approval
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { supabase, database } from '../utils/supabase';
import * as qzService from '../utils/qzTrayService';
import type { QZConnectionStatus, BarcodeLabelData } from '../utils/qzTrayService';

interface QZPrintSettings {
  barcodePrinterName: string | null;
  reportPrinterName: string | null;
  autoPrintBarcodeOnOrder: boolean;
  autoPrintReportOnApproval: boolean;
}

interface QZTrayContextValue {
  status: QZConnectionStatus;
  settings: QZPrintSettings;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  /** Call after order creation if auto-print barcode is enabled */
  autoPrintBarcode: (data: BarcodeLabelData) => Promise<void>;
  /** Call after report PDF URL is ready if auto-print report is enabled */
  autoPrintReport: (pdfUrl: string) => Promise<void>;
}

const defaultSettings: QZPrintSettings = {
  barcodePrinterName: null,
  reportPrinterName: null,
  autoPrintBarcodeOnOrder: false,
  autoPrintReportOnApproval: false,
};

export const QZTrayContext = createContext<QZTrayContextValue>({
  status: 'disconnected',
  settings: defaultSettings,
  connect: async () => {},
  disconnect: async () => {},
  autoPrintBarcode: async () => {},
  autoPrintReport: async () => {},
});

export const useQZTray = () => useContext(QZTrayContext);

export const QZTrayProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<QZConnectionStatus>('disconnected');
  const [settings, setSettings] = useState<QZPrintSettings>(defaultSettings);
  const settingsLoadedRef = useRef(false);

  // Subscribe to QZ Tray connection status changes
  useEffect(() => {
    const unsubscribe = qzService.onConnectionStatusChange(setStatus);
    return unsubscribe;
  }, []);

  // Load and merge lab + location printer settings once on mount
  useEffect(() => {
    if (settingsLoadedRef.current) return;
    settingsLoadedRef.current = true;

    (async () => {
      try {
        const [labId, locationId] = await Promise.all([
          database.getCurrentUserLabId(),
          database.getCurrentUserPrimaryLocation(),
        ]);

        if (!labId) return;

        // Fetch lab defaults + location overrides in parallel
        const [labResult, locationResult] = await Promise.all([
          supabase
            .from('labs')
            .select('barcode_printer_name, report_printer_name, auto_print_barcode_on_order, auto_print_report_on_approval')
            .eq('id', labId)
            .single(),
          locationId
            ? supabase
                .from('locations')
                .select('barcode_printer_name, report_printer_name, auto_print_barcode_on_order, auto_print_report_on_approval')
                .eq('id', locationId)
                .single()
            : Promise.resolve({ data: null }),
        ]);

        const lab = labResult.data;
        const loc = locationResult.data;

        if (!lab) return;

        // Location values override lab values; null/undefined = inherit from lab
        const resolved: QZPrintSettings = {
          barcodePrinterName:
            loc?.barcode_printer_name ?? lab.barcode_printer_name ?? null,
          reportPrinterName:
            loc?.report_printer_name ?? lab.report_printer_name ?? null,
          autoPrintBarcodeOnOrder:
            loc?.auto_print_barcode_on_order ?? lab.auto_print_barcode_on_order ?? false,
          autoPrintReportOnApproval:
            loc?.auto_print_report_on_approval ?? lab.auto_print_report_on_approval ?? false,
        };

        setSettings(resolved);

        // Auto-connect if any auto-print is enabled and a printer is named
        if (
          (resolved.autoPrintBarcodeOnOrder && resolved.barcodePrinterName) ||
          (resolved.autoPrintReportOnApproval && resolved.reportPrinterName)
        ) {
          qzService.connect().catch(() => {
            // Silent — user can connect manually from Settings
          });
        }
      } catch {
        // Non-critical — printing is optional
      }
    })();
  }, []);

  const connect = useCallback(async () => {
    await qzService.connect();
  }, []);

  const disconnect = useCallback(async () => {
    await qzService.disconnect();
  }, []);

  const autoPrintBarcode = useCallback(async (data: BarcodeLabelData) => {
    if (!settings.autoPrintBarcodeOnOrder) return;
    if (!settings.barcodePrinterName) {
      console.warn('[QZ] Auto-print barcode skipped: no barcode printer configured for this location.');
      return;
    }
    if (!qzService.isConnected()) {
      console.warn('[QZ] Auto-print barcode skipped: QZ Tray not connected.');
      return;
    }
    try {
      await qzService.printBarcodeLabel(settings.barcodePrinterName, data);
      console.log('[QZ] Barcode label printed for', data.sampleId);
    } catch (err) {
      console.error('[QZ] Barcode print failed:', err);
    }
  }, [settings]);

  const autoPrintReport = useCallback(async (pdfUrl: string) => {
    if (!settings.autoPrintReportOnApproval) return;
    if (!settings.reportPrinterName) {
      console.warn('[QZ] Auto-print report skipped: no report printer configured for this location.');
      return;
    }
    if (!qzService.isConnected()) {
      console.warn('[QZ] Auto-print report skipped: QZ Tray not connected.');
      return;
    }
    try {
      await qzService.printPDFFromUrl(settings.reportPrinterName, pdfUrl);
      console.log('[QZ] Report printed from', pdfUrl);
    } catch (err) {
      console.error('[QZ] Report print failed:', err);
    }
  }, [settings]);

  return (
    <QZTrayContext.Provider value={{ status, settings, connect, disconnect, autoPrintBarcode, autoPrintReport }}>
      {children}
    </QZTrayContext.Provider>
  );
};
