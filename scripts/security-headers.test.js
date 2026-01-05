const request = require('supertest');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Run these tests while server.js is running on localhost:3000
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

describe('Security headers', function(){
  it('should include common security headers on index', async function(){
    const res = await request(BASE).get('/');
    assert.ok(res.headers['x-frame-options'] || res.headers['x-xss-protection'] || res.headers['content-security-policy'] || res.headers['x-content-type-options']);
    saveResult('security_headers_index', res);
  });

  it('should not leak server internals in headers', async function(){
    const res = await request(BASE).get('/');
    const serverHeader = res.headers['server'] || '';
    assert.ok(!/express|nginx|iis|apache/i.test(serverHeader));
    saveResult('server_header_check', res);
  });
});
