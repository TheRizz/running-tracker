/**
 * Minimal in-memory stand-ins for the Google Apps Script services this
 * project uses, so the real src/*.js files can run end-to-end under Node.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

class FakeRange {
  constructor(sheet, row, col, nRows, nCols) { Object.assign(this, { sheet, row, col, nRows, nCols }); }
  getValues() {
    const out = [];
    for (let r = 0; r < this.nRows; r++) {
      const line = [];
      for (let c = 0; c < this.nCols; c++) {
        const v = (this.sheet.data[this.row - 1 + r] || [])[this.col - 1 + c];
        line.push(v === undefined ? '' : v);
      }
      out.push(line);
    }
    return out;
  }
  setValues(vals) {
    if (vals.length !== this.nRows || vals[0].length !== this.nCols) throw new Error(`setValues size mismatch ${vals.length}x${vals[0].length} vs ${this.nRows}x${this.nCols}`);
    vals.forEach((line, r) => line.forEach((v, c) => this.sheet.set(this.row + r, this.col + c, v)));
    return this;
  }
  setValue(v) { this.sheet.set(this.row, this.col, v); return this; }
  setFontWeight() { return this; }
  setNumberFormat() { return this; }
}

class FakeSheet {
  constructor(name) { this.name = name; this.data = []; }
  set(row, col, v) {
    while (this.data.length < row) this.data.push([]);
    this.data[row - 1][col - 1] = v;
  }
  getLastRow() {
    for (let i = this.data.length - 1; i >= 0; i--) if ((this.data[i] || []).some(v => v !== '' && v !== undefined)) return i + 1;
    return 0;
  }
  getLastColumn() { return Math.max(0, ...this.data.map(r => r.length)); }
  getRange(a, b, c, d) {
    if (typeof a === 'string') return new FakeRange(this, 1, 1, 1, 1); // A1 notation only used for formatting/notes
    return new FakeRange(this, a, b, c || 1, d || 1);
  }
  getDataRange() { return new FakeRange(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  appendRow(row) { const r = this.getLastRow() + 1; row.forEach((v, i) => this.set(r, i + 1, v)); }
  insertRowAfter(r) { this.data.splice(r, 0, []); }
  deleteRows(start, n) { this.data.splice(start - 1, n); }
  clearContents() { this.data = []; }
  setFrozenRows() {}
}

function makeContext({ garmin }) {
  const sheets = {};
  const ss = {
    getSheetByName: n => sheets[n] || null,
    insertSheet: n => (sheets[n] = new FakeSheet(n)),
    getSheets: () => Object.values(sheets),
    deleteSheet: s => delete sheets[s.name],
    toast: () => {}
  };
  const props = {};
  const fetches = [];
  const triggers = [];
  const ctx = {
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, getActive: () => ss },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = String(v); },
      deleteProperty: k => { delete props[k]; }
    }) },
    Session: { getScriptTimeZone: () => 'UTC' },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => [...crypto.createHash('sha256').update(s, 'utf8').digest()].map(b => (b > 127 ? b - 256 : b)),
      getUuid: () => crypto.randomUUID(),
      formatDate: (d, tz, fmt) => {
        const iso = d.toISOString();
        return fmt === 'yyyy-MM-dd' ? iso.slice(0, 10) : iso.slice(0, 10) + ' ' + iso.slice(11, 19);
      },
      base64DecodeWebSafe: s => [...Buffer.from(s.replace(/=+$/, ''), 'base64url')],
      newBlob: bytes => ({ getDataAsString: () => Buffer.from(bytes).toString('utf8') })
    },
    UrlFetchApp: { fetch: (url, opt) => { fetches.push({ url, opt }); return garmin(url, opt); } },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ text: t, setMimeType() { return this; } }) },
    ScriptApp: {
      getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/FAKE/exec' }),
      getProjectTriggers: () => triggers,
      deleteTrigger: t => triggers.splice(triggers.indexOf(t), 1),
      newTrigger: fn => ({ timeBased: () => ({ everyHours: h => ({ create: () => triggers.push({ fn, h, getHandlerFunction: () => fn }) }) }) })
    }
  };
  vm.createContext(ctx);
  const dir = path.join(__dirname, '..', 'src');
  for (const f of ['Config.js', 'Logic.js', 'Store.js', 'Garmin.js', 'WebApp.js', 'Setup.js']) {
    vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  }
  return { ctx, sheets, props, fetches, triggers };
}

function fakeJwt(expSeconds) {
  const b = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'none' })}.${b({ exp: expSeconds })}.sig`;
}

function response(code, body) {
  return { getResponseCode: () => code, getContentText: () => (typeof body === 'string' ? body : JSON.stringify(body)) };
}

module.exports = { makeContext, fakeJwt, response };
