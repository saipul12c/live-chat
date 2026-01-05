const request = require('supertest');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const BASE = process.env.BASE_URL || 'http://localhost:3000';

const REPORT_DIR = path.join(__dirname, 'test_reports');
const REPORT_FILE = path.join(REPORT_DIR, 'collected_data.json');
function ensureReportDir(){ if(!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR); }
function saveResult(name, resOrObj){
  ensureReportDir();
  let entry;
  if(resOrObj && resOrObj.status){
    const snippet = (resOrObj.text && resOrObj.text.slice(0,1000)) || '';
    entry = { time: new Date().toISOString(), name, status: resOrObj.status, headers: resOrObj.headers, bodySnippet: snippet };
  } else {
    entry = { time: new Date().toISOString(), name, detail: resOrObj };
  }
  let data = [];
  try{ data = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8')||'[]'); }catch(e){}
  data.push(entry);
  fs.writeFileSync(REPORT_FILE, JSON.stringify(data, null, 2));
}

describe('Rate limiting & brute-force protections (non-exploitative)', function(){
  it('should not crash when sending many quick requests to login endpoint', async function(){
    const req = request(BASE).post('/login');
    let lastStatus = 0;
    const statuses = [];
    for(let i=0;i<20;i++){
      // send simple payloads; we are not trying to brute-force real credentials
      // the purpose is to ensure server remains responsive and returns reasonable codes
      // small delay to be polite
      // eslint-disable-next-line no-await-in-loop
      const res = await req.send({ username: 'none'+i, password: 'x' });
      lastStatus = res.status;
      statuses.push(res.status);
    }
    saveResult('rate_limit_statuses', { counts: statuses.reduce((acc,s)=>{ acc[s]=(acc[s]||0)+1; return acc; }, {}) , lastStatus});
    assert.ok(lastStatus < 500);
  });
});
