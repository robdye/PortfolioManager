// Portfolio Manager Digital Worker — Voice gate
// Toggled via Teams chat commands ("enable voice" / "disable voice").
// Default: disabled — voice must be explicitly enabled before each demo.

// Auto-enable when VOICELIVE_ENDPOINT is configured
let _enabled = !!process.env.VOICELIVE_ENDPOINT;

export function isVoiceEnabled(): boolean {
  return _enabled;
}

export function enableVoice(): void {
  _enabled = true;
  console.log('[voice] Voice gate ENABLED');
}

export function disableVoice(): void {
  _enabled = false;
  console.log('[voice] Voice gate DISABLED');
}

export type VoiceCommand = 'enable' | 'disable' | 'status' | null;

export function detectVoiceCommand(text: string): VoiceCommand {
  const lower = text.toLowerCase().trim();
  if (/\b(enable|turn on|activate|start)\b.*\bvoice\b/.test(lower)) return 'enable';
  if (/\bvoice\b.*\b(enable|on|activate|start)\b/.test(lower)) return 'enable';
  if (lower === 'enable voice' || lower === 'voice on') return 'enable';

  if (/\b(disable|turn off|deactivate|stop)\b.*\bvoice\b/.test(lower)) return 'disable';
  if (/\bvoice\b.*\b(disable|off|deactivate|stop)\b/.test(lower)) return 'disable';
  if (lower === 'disable voice' || lower === 'voice off') return 'disable';

  if (/\bvoice\b.*\bstatus\b/.test(lower)) return 'status';
  return null;
}
