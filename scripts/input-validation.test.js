const request = require('supertest');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const BASE = process.env.BASE_URL || 'http://localhost:3000';

const REPORT_DIR = path.join(__dirname, 'test_reports');
const REPORT_FILE = path.join(REPORT_DIR, 'collected_data.json');
function ensureReportDir(){ if(!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR); }
function saveResult(name, res){
  ensureReportDir();
  const snippet = (res.text && res.text.slice(0, 1000)) || '';
  const entry = { time: new Date().toISOString(), name, status: res.status, headers: res.headers, bodySnippet: snippet };
  let data = [];
  try{ data = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8')||'[]'); }catch(e){}
  data.push(entry);
  fs.writeFileSync(REPORT_FILE, JSON.stringify(data, null, 2));
}

describe('Input validation & sanitization (non-exploitative)', function(){
  it('should return 400 or reject malformed JSON payloads', async function(){
    const malformed = ['{bad json', '', 'null', '[]', '{"username":'];
    for(const m of malformed){
      const res = await request(BASE).post('/register').set('Content-Type','application/json').send(m);
      assert.ok([400,422,500].includes(res.status));
      saveResult('malformed_json_' + (m||'empty'), res);
    }
  });

  it('should not reflect raw input into HTML responses unescaped', async function(){
    // submit a username containing angle brackets and ensure it is not echoed raw
    const payloads = [
      { username: '<script>alert(1)</script>', password: 'x'},
      { username: '<b>bold</b>', password: 'x'},
      { username: 'normal', password: 'x'}
    ];
    for(const payload of payloads){
      const res = await request(BASE).post('/register').send(payload);
      // server may redirect or return errors; ensure response body does not contain the raw string
      assert.ok(!/\<script\>alert\(1\)\<\/script\>/.test(res.text));
      saveResult('input_reflection_check_' + payload.username.slice(0,10), res);
    }
  });
});
