/**
 * Print bridge context.
 *
 * The export names stay as QZTrayContext/useQZTray during Phase 1 so the
 * existing app can move from QZ Tray direct printing to queue-backed LIMS
 * Utility printing without broad import churn.
 *
 * Settings resolution (location overrides lab):
 *   barcodePrinterName      = non-empty location.barcode_printer_name ?? non-empty lab.barcode_printer_name
 *   reportPrinterName       = non-empty location.report_printer_name ?? non-empty lab.report_printer_name
 *   barcodeBrowserPrintEnabled = location.barcode_browser_print_enabled ?? lab.barcode_browser_print_enabled
 *   autoPrintBarcodeOnOrder = location.auto_print_barcode_on_order ?? lab.auto_print_barcode_on_order
 *   autoPrintReportOnApproval = location.auto_print_report_on_approval ?? lab.auto_print_report_on_approval
 *   barcodeLabelLayout      = location.barcode_label_layout ?? lab.barcode_label_layout ?? app default
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { database, supabase } from '../utils/supabase';
import * as printService from '../utils/qzTrayService';
import type { BarcodeLabelData, QZConnectionStatus } from '../utils/qzTrayService';
import {
  DEFAULT_LABEL_LAYOUT,
  normalizeLabelLayout,
  setActiveLabelLayout,
  type LabelLayout,
} from '../utils/labelLayout';

interface QZPrintSettings {
  barcodePrinterName: string | null;
  reportPrinterName: string | null;
  barcodeBrowserPrintEnabled: boolean;
  autoPrintBarcodeOnOrder: boolean;
  autoPrintReportOnApproval: boolean;
  barcodeLabelLayout: LabelLayout;
}

interface QZTrayContextValue {
  status: QZConnectionStatus;
  settings: QZPrintSettings;
  refreshSettings: () => Promise<QZPrintSettings>;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  autoPrintBarcode: (data: BarcodeLabelData) => Promise<void>;
  autoPrintBarcodes: (labels: BarcodeLabelData[]) => Promise<void>;
  autoPrintReport: (pdfUrl: string) => Promise<void>;
}

const defaultSettings: QZPrintSettings = {
  barcodePrinterName: null,
  reportPrinterName: null,
  barcodeBrowserPrintEnabled: false,
  autoPrintBarcodeOnOrder: false,
  autoPrintReportOnApproval: false,
  barcodeLabelLayout: DEFAULT_LABEL_LAYOUT,
};

export const QZTrayContext = createContext<QZTrayContextValue>({
  status: 'connected',
  settings: defaultSettings,
  refreshSettings: async () => defaultSettings,
  connect: async () => {},
  disconnect: async () => {},
  autoPrintBarcode: async () => {},
  autoPrintBarcodes: async () => {},
  autoPrintReport: async () => {},
});

export const useQZTray = () => useContext(QZTrayContext);

export const QZTrayProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<QZConnectionStatus>('connected');
  const [settings, setSettings] = useState<QZPrintSettings>(defaultSettings);
  const settingsLoadedRef = useRef(false);

  const normalizePrinterName = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  useEffect(() => {
    return printService.onConnectionStatusChange(setStatus);
  }, []);

  /**
   * Publish the resolved layout to the label renderers as well as to React
   * state. The PDF and ZPL builders read it from there, which keeps every
   * existing print call site unchanged.
   */
  const applySettings = useCallback((next: QZPrintSettings) => {
    setSettings(next);
    setActiveLabelLayout(next.barcodeLabelLayout);
  }, []);

  const refreshSettings = useCallback(async (): Promise<QZPrintSettings> => {
    try {
      const [labId, locationId] = await Promise.all([
        database.getCurrentUserLabId(),
        database.getCurrentUserPrimaryLocation(),
      ]);

      if (!labId) {
        applySettings(defaultSettings);
        return defaultSettings;
      }

      const [labResult, locationResult] = await Promise.all([
        supabase
          .from('labs')
          .select('barcode_printer_name, report_printer_name, barcode_browser_print_enabled, barcode_label_layout, auto_print_barcode_on_order, auto_print_report_on_approval')
          .eq('id', labId)
          .single(),
        locationId
          ? supabase
              .from('locations')
              .select('barcode_printer_name, report_printer_name, barcode_browser_print_enabled, barcode_label_layout, auto_print_barcode_on_order, auto_print_report_on_approval')
              .eq('id', locationId)
              .eq('lab_id', labId)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      const lab = labResult.data;
      const loc = locationResult.data;

      if (!lab) {
        applySettings(defaultSettings);
        return defaultSettings;
      }

      const nextSettings = {
        barcodePrinterName:
          normalizePrinterName(loc?.barcode_printer_name) ??
          normalizePrinterName(lab.barcode_printer_name),
        reportPrinterName:
          normalizePrinterName(loc?.report_printer_name) ??
          normalizePrinterName(lab.report_printer_name),
        barcodeBrowserPrintEnabled:
          loc?.barcode_browser_print_enabled ?? lab.barcode_browser_print_enabled ?? false,
        autoPrintBarcodeOnOrder:
          loc?.auto_print_barcode_on_order ?? lab.auto_print_barcode_on_order ?? false,
        autoPrintReportOnApproval:
          loc?.auto_print_report_on_approval ?? lab.auto_print_report_on_approval ?? false,
        barcodeLabelLayout: normalizeLabelLayout(
          loc?.barcode_label_layout ?? lab.barcode_label_layout
        ),
      };

      applySettings(nextSettings);
      return nextSettings;
    } catch {
      applySettings(defaultSettings);
      return defaultSettings;
    }
  }, [applySettings]);

  useEffect(() => {
    if (settingsLoadedRef.current) return;
    settingsLoadedRef.current = true;
    refreshSettings();
  }, [refreshSettings]);

  const connect = useCallback(async () => {
    await printService.connect();
  }, []);

  const disconnect = useCallback(async () => {
    await printService.disconnect();
  }, []);

  const autoPrintBarcodes = useCallback(async (labels: BarcodeLabelData[]) => {
    console.debug('[PrintBridge][Context] autoPrintBarcodes invoked', {
      enabled: settings.autoPrintBarcodeOnOrder,
      printerName: settings.barcodePrinterName,
      browserPrint: settings.barcodeBrowserPrintEnabled,
      count: labels.length,
    });

    if (!settings.autoPrintBarcodeOnOrder) return;
    if (labels.length === 0) return;
    if (!settings.barcodePrinterName) {
      console.warn('[PrintBridge] Auto-print barcode skipped: no barcode printer configured for this location.');
      return;
    }

    if (settings.barcodeBrowserPrintEnabled) {
      printService.printBarcodeLabelsInBrowser(labels, settings.barcodePrinterName);
      return;
    }

    try {
      for (const label of labels) {
        await printService.printBarcodeLabel(settings.barcodePrinterName, label);
      }
      console.log('[PrintBridge] Barcode label print jobs queued:', labels.length);
    } catch (err) {
      console.error('[PrintBridge] Barcode print queue failed:', err);
    }
  }, [settings]);

  const autoPrintBarcode = useCallback(async (data: BarcodeLabelData) => {
    await autoPrintBarcodes([data]);
  }, [autoPrintBarcodes]);

  const autoPrintReport = useCallback(async (pdfUrl: string) => {
    console.debug('[PrintBridge][Context] autoPrintReport invoked', {
      enabled: settings.autoPrintReportOnApproval,
      printerName: settings.reportPrinterName,
      pdfUrl,
    });

    if (!settings.autoPrintReportOnApproval) return;
    if (!settings.reportPrinterName) {
      console.warn('[PrintBridge] Auto-print report skipped: no report printer configured for this location.');
      return;
    }

    try {
      await printService.printPDFFromUrl(settings.reportPrinterName, pdfUrl);
      console.log('[PrintBridge] Report print job queued from', pdfUrl);
    } catch (err) {
      console.error('[PrintBridge] Report print queue failed:', err);
    }
  }, [settings]);

  return (
    <QZTrayContext.Provider value={{ status, settings, refreshSettings, connect, disconnect, autoPrintBarcode, autoPrintBarcodes, autoPrintReport }}>
      {children}
    </QZTrayContext.Provider>
  );
};
