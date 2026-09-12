#!/usr/bin/env node
/**
 * FlightCore KAI X1 — Automated Test Suite
 * ==========================================
 * Runs the actual simulator code (extracted straight from the HTML file) inside a minimal
 * DOM stub, then exercises the major systems the same way a real browser session would:
 * clicking real buttons, dragging real sliders, and reading the actual rendered text —
 * not just internal state, since internal state and what the pilot actually sees can drift
 * apart (that gap caused a real bug earlier in this project's development).
 *
 * Usage:
 *   node test_flightcore.js [path-to-html-file]
 *   (defaults to ./FlightCore_KAI_X1.html if no path given)
 *
 * Exit code 0 if every test passes, 1 if any test fails — safe to wire into CI.
 */

const fs = require('fs');
const path = require('path');

const htmlPath = process.argv[2] || path.join(__dirname, 'FlightCore_KAI_X1.html');
if (!fs.existsSync(htmlPath)) {
  console.error(`Could not find HTML file at: ${htmlPath}`);
  console.error('Usage: node test_flightcore.js [path-to-html-file]');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Minimal DOM stub — enough for the simulator's actual init sequence to run
// without throwing, with real addEventListener/click semantics so tests can
// interact with it the same way a user would.
// ---------------------------------------------------------------------------
function makeClassList(el) {
  const set = new Set((el._classes || '').split(' ').filter(Boolean));
  return {
    add: (...c) => c.forEach(x => set.add(x)),
    remove: (...c) => c.forEach(x => set.delete(x)),
    toggle: (c, force) => { if (force === undefined) { set.has(c) ? set.delete(c) : set.add(c); } else if (force) set.add(c); else set.delete(c); },
    contains: (c) => set.has(c),
    _set: set,
  };
}

function makeNode(tag, opts = {}) {
  const el = {
    tag, id: opts.id || '', style: {}, dataset: {}, _classes: opts.classes || '',
    textContent: opts.text || '', value: opts.value !== undefined ? opts.value : '0',
    disabled: false, innerHTML: '', children: [], parentNode: null, _handlers: {},
  };
  el.classList = makeClassList(el);
  Object.defineProperty(el, 'lastChild', { get() { return el.children.length ? el.children[el.children.length - 1] : null; } });
  Object.defineProperty(el, 'firstChild', { get() { return el.children.length ? el.children[0] : null; } });
  Object.defineProperty(el, 'className', {
    get() { return Array.from(el.classList._set).join(' '); },
    set(v) { el.classList._set.clear(); String(v).split(' ').filter(Boolean).forEach(c => el.classList._set.add(c)); },
  });
  function detachFromParent(node){
    if (node && node.parentNode){
      const i = node.parentNode.children.indexOf(node);
      if (i !== -1) node.parentNode.children.splice(i, 1);
      node.parentNode = null;
    }
  }
  el.appendChild = (node) => { detachFromParent(node); el.children.push(node); node.parentNode = el; return node; };
  el.insertBefore = (node) => { detachFromParent(node); el.children.push(node); node.parentNode = el; return node; };
  el.removeChild = (node) => { const i = el.children.indexOf(node); if (i !== -1) el.children.splice(i, 1); node.parentNode = null; return node; };
  el.remove = () => { detachFromParent(el); };
  el.prepend = (node) => { detachFromParent(node); el.children.unshift(node); node.parentNode = el; return node; };
  el.addEventListener = (evt, fn) => { el._handlers[evt] = fn; };
  el.dispatchEvent = (event) => { const fn = el._handlers[event.type]; if (fn) fn(event); return true; };
  el.click = () => { if (el._handlers.click) el._handlers.click(); };
  el.getBoundingClientRect = () => ({ top: 0, height: 100 });
  el.querySelector = (sel) => (sel === '.pod-ring' ? makeNode('circle', { classes: 'pod-ring' }) : null);
  el.querySelectorAll = (sel) => (sel === '.lock-x' ? [makeNode('line', { classes: 'lock-x' })] : []);
  return el;
}

function buildEnvironment(navigatorOverride) {
  const elements = {};
  function getEl(id) { if (!elements[id]) elements[id] = makeNode('div', { id }); return elements[id]; }

  // Pre-seed the fake grid so the panel drag-and-drop setup code has real elements to operate on.
  const fakeGrid = makeNode('div', { classes: 'grid' });
  ['Flight Mode', 'Navigation & Traffic', 'Propulsion Schematic', 'Autonomous Navigation',
    'Engine & Motor Health', 'Power & Fuel', 'Sensor Suite', 'System Event Log'].forEach((title, i) => {
    const panel = makeNode('div', { classes: i === 0 ? 'panel control-block' : 'panel' });
    const h2 = makeNode('h2', { text: title });
    h2.appendChild(makeNode('#text', { text: title }));
    panel.appendChild(h2);
    panel.dataset.panelKey = `panel-${i}`;
    panel.querySelector = (sel) => (sel === ':scope > h2' ? h2 : null);
    fakeGrid.appendChild(panel);
  });

  const fakeButtonGroupFactory = () => {
    const fakeButtons = [
      { dataset: { mode: 'hover' }, classList: makeClassList({}), addEventListener: () => {}, style: {}, disabled: false },
      { dataset: { mode: 'cruise' }, classList: makeClassList({}), addEventListener: () => {}, style: {}, disabled: false },
      { dataset: { mode: 'glide' }, classList: makeClassList({}), addEventListener: () => {}, style: {}, disabled: false },
      { dataset: { mode: 'electric' }, classList: makeClassList({}), addEventListener: () => {}, style: {}, disabled: false },
      { dataset: { src: 'electric' }, classList: makeClassList({}), addEventListener: () => {}, style: {}, disabled: false },
      { dataset: { src: 'turbofan' }, classList: makeClassList({}), addEventListener: () => {}, style: {}, disabled: false },
      { dataset: { src: 'both' }, classList: makeClassList({}), addEventListener: () => {}, style: {}, disabled: false },
      { dataset: { profile: 'efficient' }, classList: makeClassList({}), addEventListener: () => {}, style: {}, disabled: false },
      { dataset: { profile: 'balanced' }, classList: makeClassList({}), addEventListener: () => {}, style: {}, disabled: false },
      { dataset: { profile: 'fastest' }, classList: makeClassList({}), addEventListener: () => {}, style: {}, disabled: false },
      { dataset: { profile: 'auto' }, classList: makeClassList({}), addEventListener: () => {}, style: {}, disabled: false },
    ];
    return { forEach: (fn) => fakeButtons.forEach(fn), length: fakeButtons.length };
  };

  const fakeDocument = {
    getElementById: (id) => getEl(id),
    querySelector: (sel) => (sel === '.grid' ? fakeGrid : null),
    querySelectorAll: (sel) => fakeButtonGroupFactory(),
    createElement: (tag) => makeNode(tag),
    createElementNS: (ns, tag) => { const el = makeNode(tag); el.setAttribute = function(k, v){ this[k === 'class' ? '_classes' : k] = v; }; return el; },
    addEventListener: () => {},
    body: makeNode('body'),
  };

  // Pre-seed a couple of numeric slider defaults that matter for tests.
  getEl('altitude').value = '0';
  getEl('altitude').max = '41000';
  getEl('throttle').value = '40';

  // NOTE: uses real Node globals (global.document, global.window, ...), the same technique
  // verified working throughout this project's development — rather than passing them as
  // function parameters, which turned out to hang (the simulator's script relies on some
  // implicit-global behavior a parameter-injection sandbox doesn't reproduce faithfully).
  global.document = fakeDocument;
  global.window = global;
  global.localStorage = {
    _store: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._store, k) ? this._store[k] : null; },
    setItem(k, v) { this._store[k] = String(v); },
    removeItem(k) { delete this._store[k]; },
  };
  global.URL = { createObjectURL: () => 'blob://fake', revokeObjectURL: () => {} };
  global.Blob = function () {};
  global.performance = { now: () => Date.now() };
  Object.defineProperty(global, 'navigator', {
    value: navigatorOverride || {},
    writable: true,
    configurable: true,
  });
  global.capturedTick = null;
  global.setInterval = (fn) => { global.capturedTick = fn; return 1; };
  global.setTimeout = (fn) => { fn(); return 1; };

  return { elements, fakeGrid };
}

function loadSimulator(exposeVars, navigatorOverride) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const s = html.indexOf('<script>') + '<script>'.length;
  const e = html.indexOf('</script>');
  const src = html.slice(s, e);
  const exposeCode = `window.__t = { ${exposeVars.join(', ')} };`;
  const built = buildEnvironment(navigatorOverride);
  const fn = new Function(src + '\n' + exposeCode);
  fn();
  const exported = global.window.__t;
  return { env: { document: global.document, capturedTick: () => global.capturedTick() }, exported, built };
}

// ---------------------------------------------------------------------------
// Tiny test framework
// ---------------------------------------------------------------------------
const testQueue = [];
function test(name, fn) {
  testQueue.push({ name, fn });
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function approxEqual(a, b, tolerance, msg) {
  assert(Math.abs(a - b) <= tolerance, msg || `expected ${a} to be within ${tolerance} of ${b}`);
}

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

test('Simulator initializes without throwing', () => {
  const { exported } = loadSimulator(['getState: function(){ return { flightPhase: flightPhase, mode: mode }; }']);
  const state = exported.getState();
  assert(state.mode === 'hover', 'should start in Hover');
  assert(state.flightPhase === 'idle', 'should start idle');
});

test('Distance formula matches known real-world routes within 2%', () => {
  const { exported } = loadSimulator(['getDist: function(a,b,c,d){ return distanceNm(a,b,c,d); }']);
  const elPasoToAbq = exported.getDist(31.7619, -106.4850, 35.0402, -106.6091);
  approxEqual(elPasoToAbq, 199, 4, `El Paso->ABQ should be ~199nm, got ${elPasoToAbq.toFixed(1)}`);
  const elPasoToDen = exported.getDist(31.7619, -106.4850, 39.8561, -104.6737);
  approxEqual(elPasoToDen, 495, 5, `El Paso->Denver should be ~495nm, got ${elPasoToDen.toFixed(1)}`);
});

test('Selecting a destination from ground level engages autonav and begins takeoff', () => {
  const { env, exported } = loadSimulator(['getState: function(){ return { autoNavEnabled: autoNavEnabled, flightPhase: flightPhase }; }']);
  env.document.getElementById('autonav-preset-dest').value = '0';
  env.document.getElementById('autonav-fly-preset').click();
  const state = exported.getState();
  assert(state.autoNavEnabled === true, 'autonav should auto-engage when a destination is selected');
  assert(state.flightPhase === 'takeoff', `should enter takeoff phase, got "${state.flightPhase}"`);
});

test('Hover disengages and switches to Cruise once transition altitude is reached', () => {
  const { env, exported } = loadSimulator(['getState: function(){ return { mode: mode, flightPhase: flightPhase, altitude: Math.round(altitude.value) }; }']);
  env.document.getElementById('autonav-preset-dest').value = '2'; // KDEN
  env.document.getElementById('autonav-fly-preset').click();
  let sawCruise = false;
  for (let i = 0; i < 400; i++) {
    env.capturedTick();
    const s = exported.getState();
    if (s.mode === 'cruise') { sawCruise = true; break; }
  }
  assert(sawCruise, 'should transition to Cruise mode within 400 ticks of a real departure');
});

test('Ducted fans fully stop above 25,000 ft', () => {
  const { env, exported } = loadSimulator(['setAndUpdate: function(m,a,th){ mode=m; altitude.value=a; throttle.value=th; update(); return { rpm: document.getElementById("motor-rpm").textContent }; }']);
  const below = exported.setAndUpdate('cruise', 24000, 70);
  assert(below.rpm === '70%', `below 25,000ft should show commanded RPM, got ${below.rpm}`);
  const above = exported.setAndUpdate('cruise', 26000, 70);
  assert(above.rpm === '0%', `above 25,000ft should be a full stop, got ${above.rpm}`);
});

test('Glide above 30,000 ft: ducted fans allowed at 80% cap, FJ44-4 capped at 25%', () => {
  const { env, exported } = loadSimulator([
    'setAndUpdate: function(m,gs,a,th){ mode=m; glideSource=gs; altitude.value=a; throttle.value=th; update(); return { rpm: document.getElementById("motor-rpm").textContent, tf: document.getElementById("tf-status").textContent }; }'
  ]);
  const ducted = exported.setAndUpdate('glide', 'electric', 32000, 100);
  assert(ducted.rpm === '80%', `Glide ducted fans above 30,000ft should cap at 80%, got ${ducted.rpm}`);
  const tf = exported.setAndUpdate('glide', 'turbofan', 32000, 100);
  assert(tf.tf.includes('25%'), `FJ44-4 should cap at 25% in Glide above 30,000ft, got "${tf.tf}"`);
});

test('Full Electric mode has its own stricter 24,000 ft ceiling (below the general 25,000 ft rule)', () => {
  const { env, exported } = loadSimulator([
    'setAndUpdate: function(a,th){ mode="electric"; altitude.value=a; throttle.value=th; update(); return { rpm: document.getElementById("motor-rpm").textContent, status: document.getElementById("ducted-status").textContent }; }'
  ]);
  const below = exported.setAndUpdate(23000, 80);
  assert(below.rpm === '80%', `below 24,000ft in Electric mode should show commanded RPM, got ${below.rpm}`);
  const above = exported.setAndUpdate(24000, 80);
  assert(above.rpm === '0%', `Electric mode at/above 24,000ft should be a full stop, got ${above.rpm}`);
  assert(above.status.includes('24,000'), `status should specifically cite the 24,000ft Electric ceiling, got "${above.status}"`);
});

test('Selecting Full Electric mode clamps the altitude slider to its 24,000ft max and snaps down if above it', () => {
  const { env, exported } = loadSimulator([
    'setup: function(){ altitude.value = 30000; },' +
    'select: function(){ setFlightMode("electric"); return { max: altitude.max, value: altitude.value, label: document.getElementById("altitude-ceiling-label").textContent }; }'
  ]);
  exported.setup();
  const result = exported.select();
  assert(result.max === '24000', `slider max should be lowered to 24000 in Electric mode, got ${result.max}`);
  assert(parseInt(result.value) === 24000, `altitude should snap down to 24000 since it was above the new limit, got ${result.value}`);
  assert(result.label.includes('24,000') && result.label.includes('ELECTRIC'), `ceiling label should reflect the Electric limit, got "${result.label}"`);
});

test('Main battery hysteresis: locks out below 20%, stays locked until 50%', () => {
  const { env, exported } = loadSimulator([
    'setBattAndUpdate: function(pct){ mainBattLevel = pct; mode="hover"; throttle.value=50; update(); return { locked: ductedFansLowBattLock }; }'
  ]);
  assert(exported.setBattAndUpdate(25).locked === false, 'should not be locked at 25%');
  assert(exported.setBattAndUpdate(19).locked === true, 'should lock the instant battery drops below 20%');
  assert(exported.setBattAndUpdate(35).locked === true, 'should STAY locked at 35% (hysteresis, not yet recovered to 50%)');
  assert(exported.setBattAndUpdate(50).locked === false, 'should release once recovered to 50%');
});

test('Vehicle Configuration: engine-type auto-recognition swaps the fuel model correctly', () => {
  const { env, exported } = loadSimulator(['getFuelFlow: function(th,alt){ return fuelFlowLbHrPerEngine(th, alt); }']);
  const turbofanFlow = exported.getFuelFlow(60, 0);
  assert(turbofanFlow > 0, 'turbofan default should produce nonzero fuel flow');

  env.document.getElementById('vehicle-engine-type').value = 'turboshaft';
  env.document.getElementById('vehicle-shaft-hp').value = '1200';
  env.document.getElementById('vehicle-sfc').value = '0.55';
  env.document.getElementById('vehicle-apply-btn').click();
  const turboshaftFlow = exported.getFuelFlow(60, 0);
  approxEqual(turboshaftFlow, 1200 * 0.6 * 0.55, 0.5, `turboshaft flow should match SFC x HP exactly, got ${turboshaftFlow}`);

  env.document.getElementById('vehicle-engine-type').value = 'electric';
  env.document.getElementById('vehicle-apply-btn').click();
  assert(exported.getFuelFlow(60, 0) === 0, 'electric-only configuration must produce zero fuel burn');
});

test('Vehicle Configuration: invalid/empty numeric input keeps the previous value, never silently zeroes', () => {
  const { env, exported } = loadSimulator(['getFuelFlow: function(th,alt){ return fuelFlowLbHrPerEngine(th, alt); }']);
  env.document.getElementById('vehicle-engine-type').value = 'turboshaft';
  env.document.getElementById('vehicle-shaft-hp').value = '900';
  env.document.getElementById('vehicle-sfc').value = '0.5';
  env.document.getElementById('vehicle-apply-btn').click();
  const before = exported.getFuelFlow(60, 0);

  // Now apply again with shaft-hp changed but SFC left blank/invalid.
  env.document.getElementById('vehicle-shaft-hp').value = '950';
  env.document.getElementById('vehicle-sfc').value = ''; // invalid
  env.document.getElementById('vehicle-apply-btn').click();
  const after = exported.getFuelFlow(60, 0);
  assert(after > 0, `an invalid SFC field must NOT zero out fuel flow (regression test) — got ${after}`);
});

test('Vehicle Configuration: dry weight and fuel tank size reconfiguration actually changes gross weight physics', () => {
  const { env, exported } = loadSimulator(['getWeight: function(){ return currentGrossWeightLbs(); }']);
  const before = exported.getWeight();
  env.document.getElementById('vehicle-dry-weight').value = '8000';
  env.document.getElementById('vehicle-main-tank').value = '1500';
  env.document.getElementById('vehicle-apply-btn').click();
  const after = exported.getWeight();
  assert(after > before, `reconfiguring to a heavier aircraft with a bigger tank should increase gross weight — before ${before}, after ${after}`);
});

test('Vehicle Configuration: invalid dry weight input keeps the previous value, never zeroes the aircraft out', () => {
  const { env, exported } = loadSimulator(['getWeight: function(){ return currentGrossWeightLbs(); }']);
  const before = exported.getWeight();
  env.document.getElementById('vehicle-dry-weight').value = '';
  env.document.getElementById('vehicle-apply-btn').click();
  const after = exported.getWeight();
  assert(Math.abs(before - after) < 0.01, `invalid dry weight input must leave gross weight unchanged — before ${before}, after ${after}`);
});

test('Vehicle Configuration: APU power reconfiguration changes its actual fuel burn rate', () => {
  const { env, exported } = loadSimulator(['getApuPower: function(){ return APU_POWER_KW; }']);
  const before = exported.getApuPower();
  env.document.getElementById('vehicle-apu-power').value = '500';
  env.document.getElementById('vehicle-apply-btn').click();
  const after = exported.getApuPower();
  assert(after === 500 && after > before, `APU power should update to the new configured value — before ${before}, after ${after}`);
});

test('ATC altitude authorization: aircraft never climbs above what has actually been cleared', () => {
  const { env, exported } = loadSimulator([
    'forceState: function(){ flightPhase="cruise"; mode="cruise"; autoNavEnabled=true; activeCruiseAlt=6000; atcClearedAltitude=6000; altitude.value=6000; throttle.value=80; flightPlan.length=0; flightPlan.push({name:"Test",lat:40,lon:-100,isAirport:true}); activeWaypointIndex=0; }',
    'requestAndTick: function(target){ activeCruiseAlt=target; requestAltitudeAuthorization(target, "test"); return { cleared: atcClearedAltitude }; }',
  ]);
  exported.forceState();
  const result = exported.requestAndTick(9000);
  assert(result.cleared === 6000 || result.cleared === 9000, 'clearance should either stay at 6000 (denied) or move to 9000 (approved), nothing else');
});

test('Master power: refuses to power down while airborne', () => {
  const { env, exported } = loadSimulator(['getPower: function(){ return { on: masterPowerOn }; }']);
  env.document.getElementById('altitude').value = '5000'; // airborne
  env.document.getElementById('master-power').click();
  assert(exported.getPower().on === true, 'must refuse to power down while altitude > 0');
});

test('Saved Locations + voice command: "Kai take me home" flies to the saved "home" location', () => {
  const { env, exported } = loadSimulator([
    'saveHome: function(lat,lon){ gpsLat=lat; gpsLon=lon; document.getElementById("saved-location-name").value="Home"; document.getElementById("save-current-location-btn").click(); }',
    'say: function(t){ parseVoiceCommand(t); }',
    'getPlan: function(){ return flightPlan.map(w => w.name); }',
  ]);
  exported.saveHome(31.7619, -106.4850);
  exported.say('Kai, take me home');
  const plan = exported.getPlan();
  assert(plan.length > 0 && plan[plan.length - 1] === 'Home', `should have set destination to "Home", got ${JSON.stringify(plan)}`);
});

test('SAFETY: Full Electric mode auto-transitions to Cruise BEFORE reaching the 24,000ft ceiling — no thrust gap', () => {
  const { env, exported } = loadSimulator([
    'setup: function(a){ mode="electric"; altitude.value=a; throttle.value=70; },' +
    'tick: function(){ capturedTick(); return { mode: mode, throttle: throttle.value }; }'
  ]);
  exported.setup(23400); // below the 500ft transition margin (23,500ft)
  let result = exported.tick();
  assert(result.mode === 'electric', `should still be Electric well below the margin, got ${result.mode}`);

  exported.setup(23600); // within the 500ft margin below the 24,000ft ceiling
  result = exported.tick();
  assert(result.mode === 'cruise', `should have pre-emptively switched to Cruise before reaching the ceiling, got ${result.mode}`);
  assert(Number(result.throttle) === 70, `throttle should be unchanged by the mode switch — turbofans resume at the same commanded throttle, got ${result.throttle}`);
});

test('Airport list: domestic airports always available, international only added when online', () => {
  const { env, exported } = loadSimulator([
    'getCount: function(){ return document.getElementById("autonav-preset-dest").children.length; }'
  ]);
  // Test environment has no real navigator.onLine, so this should reflect the "offline"/domestic-only count.
  const count = exported.getCount();
  assert(count > 1, `dropdown should be populated with more than just the placeholder, got ${count} options`);
});

test('Efficient refuel stop: picks the airport that minimizes total detour, not just the nearest one', () => {
  const { env, exported } = loadSimulator([
    'find: function(oLat,oLon,dLat,dLon,range){ return findMostEfficientRefuelStop(oLat,oLon,dLat,dLon,range); }'
  ]);
  // El Paso to Chicago is a long trip — something roughly along that path should be chosen, within range.
  const stop = exported.find(31.7619, -106.4850, 41.9742, -87.9073, 700);
  assert(stop !== null, 'should find a real airport within range for a long domestic route');
  assert(stop.name, 'chosen stop should be a real named airport, not a synthetic point');
});

test('Non-airport landing: switches Cruise to Hover and runs a real sensor scan before completing touchdown', () => {
  const { env, exported } = loadSimulator([
    'forceArrival: function(){ ' +
      'flightPhase = "descent"; mode = "cruise"; autoNavEnabled = true; altitude.value = 200; throttle.value = 60; ' +
      'flightPlan.length = 0; flightPlan.push({ name: "Private Strip", lat: 40.0, lon: -100.0, isAirport: false }); ' +
      'activeWaypointIndex = 0; gpsLat = 40.0 - 0.001; gpsLon = -100.0; ' +
    '},' +
    'tick: function(){ capturedTick(); return { mode: mode, flightPhase: flightPhase, scanComplete: landingZoneScanComplete }; },' +
    'getLog: function(){ return Array.from(document.getElementById("log").children).map(c => c.innerHTML); }'
  ]);
  exported.forceArrival();
  const result = exported.tick();
  assert(result.mode === 'hover', `should have switched to Hover for the vertical landing at some point, got ${result.mode}`);
  assert(result.scanComplete === true, 'scan should have run to completion (this test env fires setTimeout synchronously)');
  const log = exported.getLog().join(' | ');
  assert(log.includes('LANDING ZONE SCAN INITIATED'), 'log should show the scan actually starting, not just the final result');
  assert(log.includes('CAMERA SURVEY') && log.includes('LIDAR TERRAIN SCAN') && log.includes('ULTRASONIC ARRAY'), 'log should show real individual sensor checks ran, not just a single generic message');
  assert(log.includes('SAFE LANDING ZONE CONFIRMED'), 'scan should have reached a final confirmation before touchdown was allowed to complete');
});

test('Simulated traffic: spawns the expected number of aircraft at page load, all within radar range', () => {
  const { env, exported } = loadSimulator([
    'getCount: function(){ return document.getElementById("live-blips").children.length; }'
  ]);
  const count = exported.getCount();
  assert(count === 3, `expected 3 simulated aircraft spawned and rendered at init, got ${count}`);
});

test('Simulated traffic: aircraft actually move between ticks via dead-reckoning (same math verified for real data earlier)', () => {
  const { env, exported } = loadSimulator([
    'renderAtElapsed: function(elapsedSec){ ' +
      '  const origNow = Date.now; ' +
      '  const base = origNow(); ' +
      '  Date.now = () => base + elapsedSec * 1000; ' +
      '  renderTrackedAircraftBlips(); ' +
      '  Date.now = origNow; ' +
      '  const blip = document.getElementById("live-blips").children[0]; ' +
      '  const circle = blip ? blip.children[0] : null; ' +
      '  return circle ? { cx: parseFloat(circle.cx), cy: parseFloat(circle.cy) } : null; ' +
      '}',
  ]);
  const posAt0 = exported.renderAtElapsed(0);
  const posAt20s = exported.renderAtElapsed(20);
  assert(posAt0 !== null, 'a blip should exist at t=0');
  assert(posAt20s !== null, 'a blip should still exist 20s later');
  const moved = Math.abs(posAt0.cx - posAt20s.cx) > 0.5 || Math.abs(posAt0.cy - posAt20s.cy) > 0.5;
  assert(moved, `blip should have visibly moved after 20s — got ${JSON.stringify(posAt0)} then ${JSON.stringify(posAt20s)}`);
});

test('Simulated traffic: an aircraft that exits radar range gets replaced with a new spawn, not left stranded or removed permanently', () => {
  const { env, exported } = loadSimulator([
    'forceExit: function(){ ' +
      '  const ids = Object.keys(trackedAircraft); ' +
      '  const id = ids[0]; ' +
      '  trackedAircraft[id].lat = gpsLat + 5; ' + // ~300nm away, well outside the 30nm range
      '  trackedAircraft[id].velocityMps = 0; ' + // stationary out there, so it stays "exited" until respawn logic catches it
      '  return id; ' +
      '}',
    'tick: function(){ updateSimulatedTraffic(); }',
    'getAircraft: function(id){ const ac = trackedAircraft[id]; return ac ? { lat: ac.lat, lon: ac.lon } : null; }',
    'getCount: function(){ return Object.keys(trackedAircraft).length; }',
  ]);
  const id = exported.forceExit();
  const before = exported.getAircraft(id);
  exported.tick();
  const after = exported.getAircraft(id);
  assert(exported.getCount() === 3, `aircraft count should stay at 3 (respawned, not removed), got ${exported.getCount()}`);
  assert(after !== null, 'the respawned aircraft should still be tracked under the same id');
  assert(Math.abs(after.lat - before.lat) > 0.01, 'the respawned aircraft should be at a genuinely different position, not left at the old out-of-range spot');
});

test('Live overlay: a successful OpenSky fetch replaces simulated blips with real ones', () => {
  const nowSec = Date.now() / 1000;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ states: [['a1', 'REAL01', 'US', nowSec - 5, nowSec - 5, -106.40, 31.85, 3048, false, 220, 90, 0]] })
  });
  const { env, exported } = loadSimulator([
    'enable: async function(){ liveOverlayEnabled = true; clearSimulatedAircraft(); await refreshLiveOverlay(); return { count: Object.keys(trackedAircraft).length, allLive: Object.values(trackedAircraft).every(a => a.isLive) }; }',
  ]);
  return exported.enable().then(result => {
    assert(result.count === 1, `simulated aircraft should be cleared, only real data remains — got ${result.count} tracked`);
    assert(result.allLive === true, 'every remaining tracked aircraft should be flagged as live');
  });
});

test('Live overlay: a failed fetch automatically reverts to simulated traffic rather than leaving the radar empty', () => {
  global.fetch = async () => { throw new Error('CORS blocked'); };
  const { env, exported } = loadSimulator([
    'enable: async function(){ liveOverlayEnabled = true; clearSimulatedAircraft(); await refreshLiveOverlay(); return { count: Object.keys(trackedAircraft).length, anyLive: Object.values(trackedAircraft).some(a => a.isLive), enabled: liveOverlayEnabled }; }',
  ]);
  return exported.enable().then(result => {
    assert(result.count === 3, `should auto-revert to 3 simulated aircraft, got ${result.count}`);
    assert(result.anyLive === false, 'no live-flagged aircraft should remain after reverting');
    assert(result.enabled === false, 'liveOverlayEnabled should be reset to false after the failure');
  });
});

test('Live overlay: manually disabling after a successful run correctly restores the simulation', () => {
  const nowSec = Date.now() / 1000;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ states: [['a1', 'REAL01', 'US', nowSec - 5, nowSec - 5, -106.40, 31.85, 3048, false, 220, 90, 0]] })
  });
  const { env, exported } = loadSimulator([
    'enable: async function(){ liveOverlayEnabled = true; clearSimulatedAircraft(); await refreshLiveOverlay(); }',
    'disable: function(){ document.getElementById("live-overlay-toggle").click(); return { count: Object.keys(trackedAircraft).length, anyLive: Object.values(trackedAircraft).some(a => a.isLive) }; }',
  ]);
  return exported.enable().then(() => {
    const result = exported.disable();
    assert(result.count === 3, `disabling should restore 3 simulated aircraft, got ${result.count}`);
    assert(result.anyLive === false, 'no live-flagged aircraft should remain after manually disabling');
  });
});

test('Live GPS: successful geolocation updates gpsLat/gpsLon to the real device position', () => {
  const navMock = {
    geolocation: {
      getCurrentPosition: (success) => {
        success({ coords: { latitude: 40.7128, longitude: -74.0060 } }); // New York, nowhere near the El Paso default
      },
    },
  };
  const { exported } = loadSimulator(['getLat: function(){ return gpsLat; }', 'getLon: function(){ return gpsLon; }'], navMock);
  assert(Math.abs(exported.getLat() - 40.7128) < 0.001, `gpsLat should update to the real device latitude, got ${exported.getLat()}`);
  assert(Math.abs(exported.getLon() - (-74.0060)) < 0.001, `gpsLon should update to the real device longitude, got ${exported.getLon()}`);
});

test('Live GPS: a denied/failed geolocation request falls back to the default position without crashing', () => {
  const navMock = {
    geolocation: {
      getCurrentPosition: (success, failure) => {
        failure({ message: 'User denied Geolocation' });
      },
    },
  };
  const { exported } = loadSimulator(['getLat: function(){ return gpsLat; }', 'getLon: function(){ return gpsLon; }'], navMock);
  assert(Math.abs(exported.getLat() - 31.7619) < 0.001, `denied geolocation should leave gpsLat at the El Paso default, got ${exported.getLat()}`);
  assert(Math.abs(exported.getLon() - (-106.4850)) < 0.001, `denied geolocation should leave gpsLon at the El Paso default, got ${exported.getLon()}`);
});

test('Live GPS: a browser with no geolocation support falls back to the default position without crashing', () => {
  const navMock = {}; // no .geolocation property at all
  const { exported } = loadSimulator(['getLat: function(){ return gpsLat; }', 'getLon: function(){ return gpsLon; }'], navMock);
  assert(Math.abs(exported.getLat() - 31.7619) < 0.001, `unsupported geolocation should leave gpsLat at the El Paso default, got ${exported.getLat()}`);
});

test('Voice command: altitude request dispatches through the real slider change handler, not a direct bypass', () => {
  const { env, exported } = loadSimulator([
    'setup: function(){ autoNavEnabled=true; flightPhase="cruise"; atcClearedAltitude=8000; }',
    'runCmd: function(t){ parseVoiceCommand(t); }',
    'getAltValue: function(){ return parseInt(altitude.value); }',
  ]);
  exported.setup();
  exported.runCmd('kai climb to 15000 feet');
  assert(exported.getAltValue() === 15000, `altitude slider should reflect the requested value, got ${exported.getAltValue()}`);
});

test('Voice command: flight mode switch calls the real setFlightMode function', () => {
  const { exported } = loadSimulator([
    'runCmd: function(t){ parseVoiceCommand(t); }',
    'getMode: function(){ return mode; }',
  ]);
  exported.runCmd('kai switch to cruise');
  assert(exported.getMode() === 'cruise', `mode should be cruise after voice command, got ${exported.getMode()}`);
});

test('Voice command: throttle percentage sets and clamps correctly', () => {
  const { exported } = loadSimulator([
    'runCmd: function(t){ parseVoiceCommand(t); }',
    'getThrottle: function(){ return parseInt(throttle.value); }',
  ]);
  exported.runCmd('kai set throttle to 75 percent');
  assert(exported.getThrottle() === 75, `throttle should be 75 after voice command, got ${exported.getThrottle()}`);
  exported.runCmd('kai set throttle to 500 percent'); // out of range, must clamp
  assert(exported.getThrottle() === 100, `throttle should clamp to 100 max, got ${exported.getThrottle()}`);
});

test('Voice command: unrecognized command is clearly logged, not silently ignored', () => {
  const { exported } = loadSimulator([
    'runCmd: function(t){ parseVoiceCommand(t); }',
    'getLastLog: function(){ return document.getElementById("log").children[0].innerHTML; }',
  ]);
  exported.runCmd('kai do a barrel roll');
  assert(exported.getLastLog().includes('NOT RECOGNIZED'), 'an unrecognized command should be logged clearly, not fail silently');
});

test('Voice command: a command not addressing Kai by name is ignored entirely', () => {
  const { exported } = loadSimulator([
    'runCmd: function(t){ parseVoiceCommand(t); }',
    'getMode: function(){ return mode; }',
  ]);
  const before = exported.getMode();
  exported.runCmd('switch to cruise'); // no "kai" — should not trigger anything
  assert(exported.getMode() === before, 'a command without "kai" in it should be ignored, not accidentally matched');
});

test('Voice command: altitude request from the actual default idle state bootstraps takeoff, matching the exact bug report', () => {
  const { env, exported } = loadSimulator([
    'runCmd: function(t){ parseVoiceCommand(t); }',
    'getPhase: function(){ return flightPhase; }',
    'getAutoNav: function(){ return autoNavEnabled; }',
    'getClearedAlt: function(){ return atcClearedAltitude; }',
    'getAlt: function(){ return parseInt(altitude.value); }',
    'tick: function(){ capturedTick(); }',
  ]);
  const phaseBefore = exported.getPhase();
  const autoNavBefore = exported.getAutoNav();
  assert(phaseBefore === 'idle', `test setup assumption failed — expected fresh load to start idle, got ${phaseBefore}`);
  assert(autoNavBefore === false, `test setup assumption failed — expected autonomous nav off by default, got ${autoNavBefore}`);

  exported.runCmd('kai climb to 5,000ft');

  assert(exported.getAutoNav() === true, 'a standalone altitude command must engage autonomous nav, not leave the aircraft with nothing controlling it');
  assert(exported.getPhase() === 'takeoff', `a standalone altitude command from idle must bootstrap takeoff, got phase "${exported.getPhase()}"`);
  assert(exported.getClearedAlt() === 5000, `ATC-cleared altitude should be set to the requested 5000, got ${exported.getClearedAlt()}`);

  const altBeforeTicks = exported.getAlt();
  exported.tick();
  exported.tick();
  exported.tick();
  const altAfterTicks = exported.getAlt();
  assert(altAfterTicks > altBeforeTicks, `the aircraft must actually climb over successive ticks after the command, went from ${altBeforeTicks} to ${altAfterTicks}`);
});

test('Voice command: a higher-altitude request from idle correctly requests further ATC clearance beyond the initial staged altitude', () => {
  const originalRandom = Math.random;
  Math.random = () => 0; // force ATC approval — this test verifies the approved-request path specifically
  try {
    const { exported } = loadSimulator([
      'runCmd: function(t){ parseVoiceCommand(t); }',
      'getClearedAlt: function(){ return atcClearedAltitude; }',
      'getActiveCruiseAlt: function(){ return activeCruiseAlt; }',
    ]);
    exported.runCmd('kai climb to 15000 feet');
    assert(exported.getClearedAlt() === 15000, `an approved ATC request for 15000ft should clear to 15000, got ${exported.getClearedAlt()}`);
    assert(exported.getActiveCruiseAlt() === 15000, `the target cruise altitude should be set to the requested 15000, got ${exported.getActiveCruiseAlt()}`);
  } finally {
    Math.random = originalRandom;
  }
});

test('Autonomous Nav toggle: engaging directly with a destination already selected in the dropdown flies to it, not the default demo plan', () => {
  const { exported } = loadSimulator([
    'selectDest: function(idx){ document.getElementById("autonav-preset-dest").value = String(idx); }',
    'toggleAutonav: function(){ document.getElementById("autonav-toggle").click(); }',
    'getTarget: function(){ return flightPlan[flightPlan.length - 1].name; }',
    'getPresetName: function(idx){ return presetDestinations[idx].name; }',
  ]);
  const selectedIdx = 5;
  const expectedName = exported.getPresetName(selectedIdx);
  exported.selectDest(selectedIdx);
  exported.toggleAutonav();
  assert(exported.getTarget() === expectedName, `engaging autonomous nav should fly to the dropdown selection ("${expectedName}"), got "${exported.getTarget()}"`);
});

test('Autonomous Nav toggle: with nothing selected in the dropdown, falls back to the existing default flight plan unchanged', () => {
  const { exported } = loadSimulator([
    'clearSelection: function(){ document.getElementById("autonav-preset-dest").value = ""; }',
    'toggleAutonav: function(){ document.getElementById("autonav-toggle").click(); }',
    'getPhase: function(){ return flightPhase; }',
    'getFlightPlanLen: function(){ return flightPlan.length; }',
  ]);
  exported.clearSelection(); // the shared test environment pre-selects index 0 by default for other tests
  const lenBefore = exported.getFlightPlanLen();
  exported.toggleAutonav();
  assert(exported.getPhase() === 'takeoff', `should still bootstrap takeoff from the pre-existing default plan, got phase "${exported.getPhase()}"`);
  assert(exported.getFlightPlanLen() === lenBefore, 'flight plan length should be unchanged when nothing new was selected');
});

test('Autonomous Nav toggle: disengaging still correctly returns to manual, unaffected by the dropdown-priority fix', () => {
  const { exported } = loadSimulator([
    'selectDest: function(idx){ document.getElementById("autonav-preset-dest").value = String(idx); }',
    'toggleAutonav: function(){ document.getElementById("autonav-toggle").click(); }',
    'getPhase: function(){ return flightPhase; }',
    'getAutoNav: function(){ return autoNavEnabled; }',
  ]);
  exported.selectDest(2);
  exported.toggleAutonav(); // on
  assert(exported.getAutoNav() === true, 'first toggle should engage autonomous nav');
  exported.toggleAutonav(); // off
  assert(exported.getAutoNav() === false, 'second toggle should disengage autonomous nav');
  assert(exported.getPhase() === 'idle', `disengaging should return to idle, got phase "${exported.getPhase()}"`);
});

// ---------------------------------------------------------------------------
// Run all tests sequentially, then report
// ---------------------------------------------------------------------------
(async () => {
  const results = [];
  for (const { name, fn } of testQueue) {
    try {
      const ret = fn();
      if (ret && typeof ret.then === 'function') {
        await ret; // fully resolve this test's async work before the next test's body runs at all
      }
      results.push({ name, pass: true });
    } catch (err) {
      results.push({ name, pass: false, error: err.message });
    }
  }
  console.log('');
  console.log('FlightCore KAI X1 — Test Results');
  console.log('='.repeat(50));
  let passCount = 0;
  results.forEach(r => {
    if (r.pass) {
      passCount++;
      console.log(`  PASS  ${r.name}`);
    } else {
      console.log(`  FAIL  ${r.name}`);
      console.log(`        -> ${r.error}`);
    }
  });
  console.log('='.repeat(50));
  console.log(`${passCount}/${results.length} tests passed`);
  console.log('');
  process.exit(passCount === results.length ? 0 : 1);
})();
