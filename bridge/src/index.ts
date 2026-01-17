import 'dotenv/config';
import net from 'net';
import { createClient } from '@supabase/supabase-js';
import { SerialPort } from 'serialport';

// 1. Configuration
const LAB_ID = process.env.LAB_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // Use Service Role for backend utility
const TCP_PORT = parseInt(process.env.TCP_PORT || '5000');

if (!LAB_ID || !SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Missing environment variables (LAB_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)');
    process.exit(1);
}

// 2. Initialize Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

console.log(`🚀 LIMS Bridge Starting for Lab ID: ${LAB_ID}`);
console.log(`Connecting to Supabase: ${SUPABASE_URL}`);

// 3. TCP Server (For Analyzers connecting via Network)
const tcpServer = net.createServer((socket) => {
    console.log(`[TCP] Analyzer connected: ${socket.remoteAddress}:${socket.remotePort}`);

    socket.on('data', async (data) => {
        const rawMsg = data.toString();
        console.log(`[TCP] Received: ${rawMsg.substring(0, 50)}...`);

        // Send to Cloud
        await saveToInbox(rawMsg, 'INBOUND', 'TCP');

        // Simple ACK (ASTM/HL7 often expect ACK)
        // 0x06 is ACK in ASCII
        socket.write('\x06');
    });

    socket.on('end', () => console.log('[TCP] Analyzer disconnected'));
    socket.on('error', (err) => console.error('[TCP] Error:', err.message));
});

tcpServer.listen(TCP_PORT, () => {
    console.log(`✅ TCP Server listening on port ${TCP_PORT}`);
});


// 4. Helper: Save to Supabase
async function saveToInbox(rawContent: string, direction: 'INBOUND' | 'OUTBOUND', source: string) {
    try {
        const { error } = await supabase.from('analyzer_raw_messages').insert({
            lab_id: LAB_ID,
            direction,
            raw_content: rawContent,
            ai_status: 'pending' // Ready for AI Agent
        });

        if (error) {
            console.error('❌ Failed to save to Supabase:', error.message);
        } else {
            console.log('✅ Message saved to Inbox (queued for AI)');
        }
    } catch (err) {
        console.error('❌ Exception saving message:', err);
    }
}

// 5. Keep alive
process.on('uncaughtException', (err) => console.error('FATAL:', err));
