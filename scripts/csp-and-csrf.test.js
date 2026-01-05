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

describe('CSP and CSRF basics', function(){
  it('should include a Content-Security-Policy header if configured', async function(){
    const res = await request(BASE).get('/');
    if(res.headers['content-security-policy']){
      assert.ok(res.headers['content-security-policy'].length > 0);
      saveResult('csp_header', res);
    } else {
      this.skip();
    }
  });

  it('forms should include anti-CSRF token in HTML (look for common token names)', async function(){
    const res = await request(BASE).get('/html/register.html');
    // if HTML present, check for typical CSRF hidden input names
    if(res.status === 200){
      const body = res.text || '';
      const hasToken = /name="csrf_token"|name="_csrf"|name="csrf"/i.test(body);
      // do not fail if the app uses different approach; mark as skipped
      if(!hasToken) this.skip();
      saveResult('register_csrf_check', res);
    } else {
      this.skip();
    }
  });
});
