/**
 * A wireless M-Bus telegram as demodulated by rtl-wmbus.
 *
 * rtl-wmbus emits one line per telegram with semicolon-separated fields:
 *   MODE;CRC_OK;3OUTOF6_OK;TIMESTAMP;PACKET_RSSI;CURRENT_RSSI;SERIAL;0x<hex>
 * The hex datagram has its block CRCs already stripped ("cooked"), which is the
 * format wmbusmeters expects.
 */
export type Telegram = {
  mode: string;
  crcOk: boolean;
  threeOutOfSixOk: boolean;
  timestamp: string;
  packetRssi: number;
  currentRssi: number;
  /** Link-layer identification number (meter serial), zero-padded hex. */
  serial: string;
  /** Telegram payload as a lowercase hex string, no leading "0x". */
  hex: string;
};

/**
 * Parses one rtl-wmbus output line into a Telegram, or returns null if the line
 * is not a telegram (e.g. a banner or an unexpected format).
 */
export function parseTelegramLine(line: string): Telegram | null {
  const parts = line.trim().split(";");
  if (parts.length < 8) return null;
  const [mode, crcOk, threeOfSix, timestamp, pktRssi, curRssi, serial, hex] =
    parts;
  if (mode !== "T1" && mode !== "C1" && mode !== "S1") return null;
  const cleanHex = hex.replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]+$/.test(cleanHex)) return null;

  return {
    mode,
    crcOk: crcOk === "1",
    threeOutOfSixOk: threeOfSix === "1",
    timestamp,
    packetRssi: Number(pktRssi),
    currentRssi: Number(curRssi),
    serial: serial.toLowerCase(),
    hex: cleanHex,
  };
}
