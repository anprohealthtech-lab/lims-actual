import 'dotenv/config';
import net from 'net';
import { createClient } from '@supabase/supabase-js';
import { SerialPort } from 'serialport';

const LAB_ID = process.env.LAB_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TCP_PORT = parseInt(process.env.TCP_PORT || '5000', 10);
const ANALYZER_CONNECTION_ID = process.env.ANALYZER_CONNECTION_ID || null;

if (!LAB_ID || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing environment variables: LAB_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

console.log(`LIMS Bridge starting for lab: ${LAB_ID}`);
console.log(`Supabase: ${SUPABASE_URL}`);
if (ANALYZER_CONNECTION_ID) console.log(`Analyzer connection: ${ANALYZER_CONNECTION_ID}`);

const tcpServer = net.createServer((socket) => {
  console.log(`[TCP] Analyzer connected: ${socket.remoteAddress}:${socket.remotePort}`);

  socket.on('data', async (data) => {
    const rawMsg = stripMllp(data.toString());
    console.log(`[TCP] Received: ${rawMsg.substring(0, 80).replace(/\r/g, '\\r')}...`);

    await saveToInbox(rawMsg, 'INBOUND');

    const barcode = extractSampleBarcode(rawMsg);
    if (barcode) {
      const worklist = await fetchWorklistResponse(barcode, rawMsg);
      if (worklist?.hl7_message) {
        socket.write(frameMllp(worklist.hl7_message));
        console.log(`[TCP] Served worklist ${worklist.id} for barcode ${barcode}`);
        return;
      }
      console.log(`[TCP] No mapped worklist found for barcode ${barcode}`);
    }

    socket.write('\x06');
  });

  socket.on('end', () => console.log('[TCP] Analyzer disconnected'));
  socket.on('error', (err) => console.error('[TCP] Error:', err.message));
});

tcpServer.listen(TCP_PORT, () => {
  console.log(`TCP server listening on port ${TCP_PORT}`);
});

function stripMllp(message: string): string {
  return message
    .replace(/^\x0b/, '')
    .replace(/\x1c\r?$/, '')
    .trimEnd();
}

function frameMllp(message: string): string {
  return `\x0b${message.endsWith('\r') ? message : `${message}\r`}\x1c\r`;
}

function extractSampleBarcode(rawContent: string): string | null {
  const segments = rawContent.split(/\r|\n/).map((s) => s.trim()).filter(Boolean);

  for (const segment of segments) {
    const fields = segment.split('|');
    if (fields[0] === 'OBR') {
      const obr3 = fields[3]?.split('^')[0]?.trim();
      if (obr3) return obr3;
      const obr2 = fields[2]?.split('^')[0]?.trim();
      if (obr2) return obr2;
      // Peerless HA560 carries the sample ID in OBR-18 (Placer Field 1)
      const obr18 = fields[18]?.split('^')[0]?.trim();
      if (obr18) return obr18;
    }
  }

  for (const segment of segments) {
    const fields = segment.split('|');
    if (fields[0] === 'ORC') {
      const orc2 = fields[2]?.split('^')[0]?.trim();
      if (orc2) return orc2;
    }
  }

  for (const segment of segments) {
    const fields = segment.split('|');
    if (fields[0] === 'PID') {
      const pid3 = fields[3]?.split('^')[0]?.trim();
      if (pid3) return pid3;
    }
  }

  return null;
}

async function fetchWorklistResponse(sampleBarcode: string, rawQuery: string) {
  let query = supabase
    .from('analyzer_order_queue')
    .select('id, order_id, analyzer_connection_id, hl7_message, message_control_id, response_message_type, served_count')
    .eq('lab_id', LAB_ID)
    .eq('sample_barcode', sampleBarcode)
    .eq('status', 'mapped')
    .eq('flow_type', 'analyzer_initiated')
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(1);

  if (ANALYZER_CONNECTION_ID) {
    query = query.eq('analyzer_connection_id', ANALYZER_CONNECTION_ID);
  }

  const { data, error } = await query;
  if (error) {
    console.error('Failed to fetch worklist response:', error.message);
    return null;
  }

  const row = data?.[0] ?? null;
  if (!row) return null;

  const now = new Date().toISOString();
  const servedCount = Number(row.served_count ?? 0) + 1;

  await supabase
    .from('analyzer_order_queue')
    .update({
      served_at: now,
      served_count: servedCount,
      worklist_query: {
        sample_barcode: sampleBarcode,
        analyzer_connection_id: ANALYZER_CONNECTION_ID,
        raw_query: rawQuery,
        received_at: now,
      },
    })
    .eq('id', row.id);

  await supabase.from('analyzer_comm_log').insert({
    lab_id: LAB_ID,
    analyzer_connection_id: row.analyzer_connection_id,
    direction: 'SEND',
    message_type: row.response_message_type || 'ORR^O02',
    message_control_id: row.message_control_id,
    message_preview: String(row.hl7_message ?? '').slice(0, 500),
    message_size: String(row.hl7_message ?? '').length,
    success: true,
    order_id: row.order_id,
    queue_id: row.id,
  });

  return row;
}

async function saveToInbox(rawContent: string, direction: 'INBOUND' | 'OUTBOUND') {
  try {
    const { error } = await supabase.from('analyzer_raw_messages').insert({
      lab_id: LAB_ID,
      analyzer_connection_id: ANALYZER_CONNECTION_ID,
      direction,
      raw_content: rawContent,
      sample_barcode: extractSampleBarcode(rawContent),
      ai_status: 'pending',
    });

    if (error) {
      console.error('Failed to save to Supabase:', error.message);
    } else {
      console.log('Message saved to analyzer inbox');
    }
  } catch (err) {
    console.error('Exception saving message:', err);
  }
}

process.on('uncaughtException', (err) => console.error('FATAL:', err));

void SerialPort;
