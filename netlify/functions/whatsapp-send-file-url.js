// Use proper fetch for Node.js compatibility
const fetch = globalThis.fetch;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: 'ok' };
  }
  
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: 'Method Not Allowed' };
  }

  try {
    // Environment validation
    const base = process.env.WHATSAPP_API_BASE_URL || process.env.VITE_WHATSAPP_API_BASE_URL || 'https://app.limsapp.in/whatsapp';
    if (!process.env.WHATSAPP_API_BASE_URL && !process.env.VITE_WHATSAPP_API_BASE_URL) {
      console.warn('WHATSAPP_API_BASE_URL not configured, using default');
    }

    const body = event.body ? JSON.parse(event.body) : {};
    const {
      sessionId,
      userId,
      phoneNumber,
      to,
      url,
      fileUrl,
      caption,
      content,
      patientName,
      testName,
      fileName,
      templateData,
    } = body;

  const finalUserId = userId || null;
  const finalSessionId = finalUserId ? null : (sessionId || null);
    let resolvedPhoneNumber = phoneNumber || to;
    const resolvedFileUrl = fileUrl || url;
    const finalCaption = caption || content || '';

    if (!finalUserId && !finalSessionId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: 'userId or sessionId is required' }),
      };
    }

    if (!resolvedPhoneNumber) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: 'phoneNumber is required' }),
      };
    }

    if (!resolvedPhoneNumber.startsWith('+')) {
      console.log('Auto-prefixing phone number with + to satisfy E.164');
      resolvedPhoneNumber = `+${resolvedPhoneNumber}`;
    }

    if (!resolvedFileUrl) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: 'url is required' }),
      };
    }

    const formattedPhoneNumber = resolvedPhoneNumber;
    
    // Validate phone number format (basic E.164 check)
    const phoneRegex = /^\+[1-9]\d{1,14}$/;
    if (!phoneRegex.test(formattedPhoneNumber)) {
      console.warn('Phone number format warning:', formattedPhoneNumber, '- Expected E.164 format (+countrycode+number)');
    }

    // Construct correct API URL for external reports endpoint
    const apiUrl = `${base}/api/external/reports/send-url`;
    
    console.log('Calling backend URL:', apiUrl);
    console.log('Final values - sessionId:', finalSessionId, 'userId:', finalUserId, 'phoneNumber:', formattedPhoneNumber);

    // Prepare headers with proper authentication (hardcoded like the sample)
    const API_KEY = 'whatsapp-lims-secure-api-key-2024';
    const headers = {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY,  // Use capitalized header name as shown in curl examples
    };
    
    console.log('Using hardcoded API key for authentication');

    const mergedTemplate = { ...(templateData || {}) };
    if (patientName && !mergedTemplate.PatientName) mergedTemplate.PatientName = patientName;
    if (testName && !mergedTemplate.TestName) mergedTemplate.TestName = testName;

    const requestBody = {
      userId: finalUserId,
      sessionId: finalSessionId,
      phoneNumber: formattedPhoneNumber,
      fileUrl: resolvedFileUrl,
      caption: finalCaption || `Your report for ${patientName || 'Patient'} is ready`,
      templateData: Object.keys(mergedTemplate).length ? mergedTemplate : undefined,
      fileName: fileName || 'report.pdf',
      content: content || undefined,
      patientName: patientName || undefined,
      testName: testName || undefined,
    };
    if (!requestBody.templateData) delete requestBody.templateData;
    if (!requestBody.content) delete requestBody.content;
    if (!requestBody.patientName) delete requestBody.patientName;
    if (!requestBody.testName) delete requestBody.testName;
  if (!requestBody.sessionId) delete requestBody.sessionId;
  if (!requestBody.userId) delete requestBody.userId;

    const upstream = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });

    const responseText = await upstream.text();
    let data;
    
    try {
      data = JSON.parse(responseText);
      console.log('Backend response:', JSON.stringify(data, null, 2));
    } catch (parseError) {
      console.error('Failed to parse backend response as JSON:', responseText);
      return {
        statusCode: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          success: false, 
          error: 'Backend returned invalid JSON response',
          details: responseText.substring(0, 200)
        }),
      };
    }

    // Handle non-2xx responses properly
    if (!upstream.ok) {
      console.error('Backend error:', upstream.status, data);
      return {
        statusCode: upstream.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(data || { 
          success: false, 
          error: `Backend returned ${upstream.status}` 
        }),
      };
    }

    // Success response
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    };

  } catch (err) {
    console.error('WhatsApp send file URL error:', err);
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        success: false, 
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? String(err) : undefined
      }),
    };
  }
};
