// Motor diagnostics Phase 1: inventory report, manual ESC-firmware field, UID export rule, five-aircraft structure.
import assert from 'node:assert/strict';
import { FLEET_SIZE, INVENTORY_SCHEMA, UID_WARNING, buildInventory, collectClientInfo, exportInventoryJson, exportInventoryMarkdown, fleetSummary, newFleet, outstandingForSlot, sanitizeManual, setFleetSlot } from '../src/preflight/inventory.js';
import { ESC_FIRMWARE_FAMILIES } from '../src/preflight/versions.js';
import { ReadOnlySession } from '../src/preflight/session.js';
import { mockFcTransport } from '../src/preflight/mock-fc.js';

const pass = (t) => console.log('PASS  ' + t);
const snapOf = async (fc, opts) => new ReadOnlySession(mockFcTransport(fc), opts).collectSnapshot();

const snap = await snapOf({});
const inv = buildInventory({ snapshot: snap, manual: { aircraftLabel: 'Quad 1', aircraftClass: '5-inch', escFirmwareFamily: 'Bluejay' }, client: collectClientInfo({ userAgent: 'UA', platform: 'Win32', serial: {} }, 'mock'), now: new Date('2026-11-16T00:00:00Z') });
assert.equal(inv.schema, INVENTORY_SCHEMA); assert.equal(inv.readOnly, true);
assert.deepEqual([inv.firmware.version, inv.firmware.api, inv.firmware.allowlistStatus], ['2025.12.5', '1.47', 'candidate']);
assert.deepEqual([inv.motors.count, inv.motors.protocol, inv.motors.poleCount, inv.motors.bidirectionalDshotFlag], [4, 'DSHOT600', 14, true]);
assert.equal(inv.identity.targetName, 'SYNTH');
assert.equal(inv.storage.dataflash.totalBytes, 16777216);
assert.equal(inv.telemetry.motorsReported, 4);
assert.deepEqual(inv.blackbox.fieldsDisabledNames, []);
assert.equal(inv.blackbox.pidLoopHzEstimate, 4000);
assert.equal(inv.client.webSerial, true); assert.equal(inv.client.transport, 'mock');
pass('the report carries identity, firmware, motors, Blackbox, storage, telemetry and client groups');

assert.equal(inv.esc.firmwareFamily, 'Bluejay'); assert.equal(inv.esc.source, 'manual entry');
for (const bad of ['4-way', 'BLHeli_S; rm -rf', '', undefined, 42, null]) assert.equal(sanitizeManual({ escFirmwareFamily: bad }).escFirmwareFamily, 'Unknown');
for (const ok of ESC_FIRMWARE_FAMILIES) assert.equal(sanitizeManual({ escFirmwareFamily: ok }).escFirmwareFamily, ok);
assert.equal(sanitizeManual({ aircraftLabel: 'a\u0000b\nc' + 'x'.repeat(200) }).aircraftLabel.length, 80);
assert.ok(!/[\u0000-\u001f]/.test(sanitizeManual({ notes: 'a\u0007b\u001b[2Jc' }).notes));
assert.equal(sanitizeManual({ aircraftClass: 'jumbo' }).aircraftClass, '');
pass('the ESC firmware family is a manual enumerated field; invalid input becomes Unknown; text is cleaned and capped');
assert.ok(!JSON.stringify(snap.reads).includes('4way'));
assert.ok(!Object.keys(snap.reads).some((k) => /4WAY|ESC_/.test(k)));
pass('no snapshot read targets the ESC or the 4-way interface');

const j = JSON.parse(exportInventoryJson(inv));
assert.equal(j.identity.uidHex, null); assert.equal(j.identity.uidOmitted, true);
assert.ok(!exportInventoryJson(inv).includes('111111112222222233333333'));
assert.ok(!exportInventoryMarkdown(inv).includes('1111111122222222'));
const ju = JSON.parse(exportInventoryJson(inv, { includeUid: true }));
assert.equal(ju.identity.uidHex, '111111112222222233333333'); assert.equal(ju.identity.uidWarning, UID_WARNING);
assert.ok(exportInventoryMarkdown(inv, { includeUid: true }).includes(UID_WARNING));
assert.ok(inv.identity.uidHex, 'the in-memory report keeps the UID (local only)');
pass('the board UID is left out of an export unless the user opts in, and the opt-in carries the identifying-board warning');
assert.match(UID_WARNING, /identifies this flight controller/);

const md = exportInventoryMarkdown(inv);
assert.match(md, /ESC firmware family \(manual\) \| Bluejay/);
assert.match(md, /## Unresolved/);
assert.ok(!/safe to fly|airworth|certif/i.test(md));
pass('the Markdown export shows the manual ESC field and unresolved items, with no safety claim');

// partial and failed reads are reported as not read, never invented
const part = await snapOf({ silent: ['MSP_BLACKBOX_CONFIG', 'MSP_MOTOR_TELEMETRY'] }, { timeoutMs: 15, retries: 0 });
const pinv = buildInventory({ snapshot: part, manual: {} });
assert.equal(pinv.blackbox, null); assert.equal(pinv.telemetry, null);
assert.ok(pinv.unresolved.some((u) => /Blackbox configuration was not read/.test(u)));
assert.match(exportInventoryMarkdown(pinv), /Blackbox device \| not read/);
pass('a read that failed appears as not read and as an unresolved item');
const empty = buildInventory({ snapshot: null });
assert.equal(empty.firmware.version, null); assert.equal(empty.motors.count, null);
pass('an empty snapshot produces an empty report, not an error');

// an unsupported firmware is a normal inventory outcome: recorded, with its status
const old = buildInventory({ snapshot: await snapOf({ firmware: '4.3.2', api: '1.44', blackbox: { supported: true, device: 1, rateDenom: 1, pRatio: 1, sampleRate: 0, mask: 0, maskPresent: false } }), manual: {} });
assert.equal(old.firmware.allowlistStatus, 'unsupported'); assert.equal(old.blackbox.fieldsDisabledNames, null);
pass('an unsupported firmware is recorded with its allowlist status (a normal inventory outcome)');

// five-aircraft structure
let fleet = newFleet();
assert.equal(fleet.slots.length, FLEET_SIZE); assert.equal(FLEET_SIZE, 5);
assert.ok(fleetSummary(fleet).every((s) => !s.collected && s.outstanding.length === 1));
fleet = setFleetSlot(fleet, 3, inv);
assert.equal(fleet.slots[2].label, 'Quad 1'); assert.ok(fleet.slots[2].report);
assert.equal(newFleet().slots[2].report, null, 'setFleetSlot does not mutate other fleets');
assert.throws(() => setFleetSlot(fleet, 6, inv), RangeError); assert.throws(() => setFleetSlot(fleet, 0, inv), RangeError);
assert.throws(() => setFleetSlot(fleet, 1, { schema: 'other' }), TypeError);
const out = outstandingForSlot(fleet.slots[2]);
assert.ok(out.includes('MCU type'), 'the synthetic board gives no MCU type: still outstanding');
assert.ok(!out.includes('ESC firmware family (manual)'));
assert.equal(fleetSummary(fleet)[2].allowlist, 'candidate');
pass('the five-aircraft structure holds one report per slot and lists the hardware data still outstanding');

console.log('ALL OK');
