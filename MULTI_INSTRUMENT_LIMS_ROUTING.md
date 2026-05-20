# Multi-Instrument LIMS Bridge Routing

This note defines how LIMS and the local LIMS Bridge should exchange sample/order information and instrument results in a multi-instrument setup.

## Connection Types

Each instrument must be configured based on how that instrument communicates.

| Instrument | Bridge Mode | Direction | Example Analyzer ID |
| --- | --- | --- | --- |
| Mindray BC-5130 | TCP Client | Bridge connects to Mindray analyzer IP/port | `mindray-bc5130` |
| Meglumi | TCP Server or TCP Client, depending analyzer setting | Analyzer connects to Bridge, or Bridge connects to analyzer | `meglumi` |
| Biochemistry | TCP Server or TCP Client, depending analyzer setting | Bidirectional order/result flow | `biochem` |
| Electrolyte | COM/Serial | RS232/COM cable | `electrolyte` |

Rule:

| Analyzer setup screen says | Bridge should use |
| --- | --- |
| Analyzer has its own IP/port and waits for LIS software | TCP Client |
| Analyzer asks for LIS/server/host IP and port | TCP Server |
| Analyzer uses RS232/COM cable | COM |

## Analyzer IDs

Every instrument must have a unique `analyzer_id`.

Examples:

```text
mindray-bc5130
meglumi
biochem
electrolyte
```

LIMS must use the same `analyzer_id` when sending sample/order information to a specific instrument.

## What LIMS Sends To Bridge

For bidirectional workflow, LIMS should send pending sample/order information to the bridge with a target analyzer.

Required fields:

| Field | Required | Notes |
| --- | --- | --- |
| `order_id` | Yes | Unique LIMS order/queue ID |
| `sample_barcode` | Yes | Barcode/sample number printed on tube |
| `analyzer_id` | Yes for multi-instrument | Must match bridge analyzer ID |
| `patient_id` | Recommended | Patient identifier |
| `patient_name` | Recommended | Patient display name |
| `gender` | Optional | `M`, `F`, or other supported value |
| `date_of_birth` | Optional | Prefer `YYYYMMDD` |
| `test_codes` | Yes | LIMS test codes or mapped analyzer test codes |
| `priority` | Optional | `ROUTINE` or `STAT` |

Example JSON:

```json
{
  "order_id": "ORD-100045",
  "sample_barcode": "2601170001",
  "analyzer_id": "biochem",
  "patient_id": "P12345",
  "patient_name": "JOHN DOE",
  "gender": "M",
  "date_of_birth": "19800101",
  "test_codes": ["GLU", "UREA", "CREAT"],
  "priority": "ROUTINE"
}
```

Bridge behavior:

1. Bridge finds the active connection with matching `analyzer_id`.
2. Bridge builds/sends the analyzer message using that connection protocol.
3. Bridge reports ACK/success/failure back to LIMS if an ACK endpoint is available.

Important: if more than one analyzer is connected, LIMS should not omit `analyzer_id`.

## What Bridge Sends To LIMS

When an instrument sends results, Bridge forwards the raw instrument message to LIMS.

Current payload shape:

```json
{
  "raw_content": "MSH|^~\\&|...",
  "direction": "INBOUND",
  "analyzer_id": "mindray-bc5130"
}
```

Expected LIMS behavior:

1. Store the raw message for audit/debugging.
2. Parse HL7/ASTM/result format, or accept parsed fields if added later.
3. Match result to sample using barcode/sample ID from the message.
4. Map analyzer test codes to LIMS test codes.
5. Mark result received for the correct instrument using `analyzer_id`.

## Result Flow

```text
Analyzer -> Bridge -> LIMS
```

Example:

```text
Mindray BC-5130 -> TCP Client socket -> Bridge -> LIMS endpoint
Biochem -> TCP Server socket -> Bridge -> LIMS endpoint
Electrolyte -> COM5 -> Bridge -> LIMS endpoint
```

## Order/Sample Flow

```text
LIMS -> Bridge -> Analyzer
```

Example:

```text
LIMS order with analyzer_id=biochem -> Bridge -> biochem connection
LIMS order with analyzer_id=meglumi -> Bridge -> meglumi connection
```

## Mindray BC-5130 Specific

Mindray BC-5130 should be configured as:

```text
Bridge Mode: TCP Client
Protocol: MLLP (HL7)
Analyzer ID: mindray-bc5130
Host/IP: Mindray analyzer IP
Port: Mindray LIS port
```

Do not also create a TCP Server for the same Mindray instrument unless the analyzer manual/setup explicitly says it connects to a LIS server IP/port.

The same TCP client socket is used for both directions:

```text
Bridge connects to Mindray
Mindray sends results on that socket
Bridge sends HL7 ACK/order/query on that socket
```

## Recommended Port/ID Plan

| Analyzer | Mode | Host/Port | Protocol | Analyzer ID |
| --- | --- | --- | --- | --- |
| Mindray BC-5130 | TCP Client | Analyzer IP:LIS port | MLLP | `mindray-bc5130` |
| Meglumi | TCP Server | Bridge PC `:5001` | MLLP or RAW | `meglumi` |
| Biochemistry | TCP Server | Bridge PC `:5002` | ASTM, MLLP, or RAW | `biochem` |
| Electrolyte | COM | `COM5` | ASTM or RAW | `electrolyte` |

## Debugging Rules

Bridge raw RX logs show the first bytes received.

| RX bytes | Meaning | Bridge protocol |
| --- | --- | --- |
| `05` | ENQ handshake | ASTM |
| `0b 4d 53 48 ... 1c 0d` | MLLP-wrapped HL7 | MLLP |
| `4d 53 48` / ASCII `MSH` | Plain HL7 | RAW |
| No RX log | Traffic is not reaching Bridge | Check IP/port/COM ownership/firewall |

## Minimum Agreement Between Teams

LIMS team should provide:

1. Endpoint where Bridge posts inbound raw results.
2. Endpoint where Bridge fetches pending orders/sample info.
3. Endpoint where Bridge reports order ACK/failure.
4. Exact `analyzer_id` values to use.
5. Test code mapping strategy per analyzer.

Bridge team will provide:

1. Active connection to each analyzer.
2. Raw result forwarding with `analyzer_id`.
3. Analyzer-targeted order/sample routing.
4. ACK handling at the analyzer protocol level where supported.
5. Debug logs showing raw bytes and parsed message summaries.
