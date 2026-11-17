// Pure ESC identification from 4-way DeviceInitFlash and DeviceRead data. Unknown anything -> unavailable; never guessed.
const MODES = { 1: 'silabs', 2: 'atmel', 3: 'stk500', 4: 'arm' };
const MCU = { 0xe8b1: 'EFM8BB10x', 0xe8b2: 'EFM8BB21x', 0xe8b5: 'EFM8BB51x', 0x1f06: 'STM32F051', 0x3506: 'ARM64K' };
const SILABS_SETTINGS = { 0xe8b1: 0x1a00, 0xe8b2: 0x1a00, 0xe8b5: 0x3000 };
const ARM_EEPROM = { 0x1f06: 0x7c00, 0x3506: 0xf800 };
const AM32_BOOT_CHARS = [0x02, 0x14, 0x06];
const MAX_TEXT = 24;

// Printable ASCII up to the first byte that is not printable (NUL terminator), trimmed, clipped.
export function asciiText(bytes, start = 0, len = MAX_TEXT, max = MAX_TEXT) {
  let s = '';
  if (!bytes || typeof bytes.length !== 'number') return '';
  for (let i = start; i < start + len && i < bytes.length; i++) {
    const c = bytes[i];
    if (c < 0x20 || c > 0x7e) break;
    s += String.fromCharCode(c);
  }
  return s.trim().slice(0, max);
}

const hexSig = (sig) => (Number.isInteger(sig) ? '0x' + sig.toString(16).toUpperCase().padStart(4, '0') : null);

export function classifyInit(params) {
  if (!params || typeof params.length !== 'number' || params.length < 4) return { ok: false, mode: 'unknown', signature: null, bootChar: null, mcu: null };
  const signature = ((params[1] & 0xff) << 8) | (params[0] & 0xff);
  return { ok: true, mode: MODES[params[3]] || 'unknown', signature, bootChar: params[2] & 0xff, mcu: MCU[signature] || null };
}

export function readPlan(init) {
  if (!init || !init.ok) return [];
  if (init.mode === 'silabs' && SILABS_SETTINGS[init.signature] !== undefined) return [{ tag: 'settings', addr: SILABS_SETTINGS[init.signature], len: 0x70 }];
  if (init.mode === 'arm' && ARM_EEPROM[init.signature] !== undefined && AM32_BOOT_CHARS.includes(init.bootChar)) {
    const off = ARM_EEPROM[init.signature];
    return [{ tag: 'fileName', addr: off - 32, len: 16 }, { tag: 'settings', addr: off, len: 0xb0 }];
  }
  return [];
}

const base = (init) => ({ state: 'unavailable', family: null, version: null, target: null, mcu: init && init.mcu ? init.mcu : null, name: null, signature: init ? hexSig(init.signature) : null, mode: init && init.mode ? init.mode : null, reason: null });
const unavailable = (init, reason) => ({ ...base(init), reason });
const blank = (b, i) => b[i] === 0xff && b[i + 1] === 0xff;

function parseSilabs(init, blocks) {
  const b = blocks && blocks.settings;
  if (!b || b.length < 0x70) return unavailable(init, b ? 'short-read' : 'no-data');
  if (blank(b, 0)) return unavailable(init, 'settings-blank');
  const layout = asciiText(b, 64, 16);
  const mcuStr = asciiText(b, 80, 16);
  const name = asciiText(b, 96, 16);
  const out = { ...base(init), version: `${b[0]}.${b[1]}`, target: layout || null, name: name || null };
  if (/bluejay/i.test(name)) return { ...out, state: 'identified', family: 'Bluejay' };
  if (/BLHELI/i.test(layout + ' ' + mcuStr) || /^#.*#$/.test(layout)) return { ...out, state: 'identified', family: 'BLHeli_S' };
  return unavailable(init, 'family-not-recognised');
}

function parseArm(init, blocks) {
  if (ARM_EEPROM[init.signature] === undefined) return unavailable(init, 'unsupported-interface');
  if (!readPlan(init).length) return unavailable(init, 'family-not-recognised'); // an ARM bootloader that is not AM32: BLHeli_32 cannot be reliably identified
  const b = blocks && blocks.settings;
  if (!b || b.length < 17) return unavailable(init, b ? 'short-read' : 'no-data');
  if (blank(b, 3)) return unavailable(init, 'settings-blank');
  const file = asciiText(blocks.fileName, 0, 16);
  const name = asciiText(b, 5, 12);
  return { ...base(init), state: 'identified', family: 'AM32', version: `${b[3]}.${b[4]}`, target: file || name || null, name: name || null };
}

export function parseIdentity(init, blocks) {
  try {
    if (!init || !init.ok) return unavailable(null, 'no-init');
    if (init.mode === 'silabs') return SILABS_SETTINGS[init.signature] === undefined ? unavailable(init, 'unsupported-interface') : parseSilabs(init, blocks);
    if (init.mode === 'arm') return parseArm(init, blocks);
    return unavailable(init, 'unsupported-interface');
  } catch {
    return unavailable(init && typeof init === 'object' ? init : null, 'parse-error');
  }
}
