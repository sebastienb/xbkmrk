// Capture the unmodified web UI against a disposable, synthetic local archive.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base=process.env.SCREENSHOT_BASE_URL || 'http://127.0.0.1:18770';
if(!['127.0.0.1','localhost'].includes(new URL(base).hostname)) throw new Error('Only a local demo server may be captured.');
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
const context=await browser.newContext({viewport:{width:1440,height:1100},deviceScaleFactor:1,colorScheme:'light'});
await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
const response=await context.request.post(base+'/api/auth/login',{data:{password:'demo-only-password'}});
if(!response.ok()) throw new Error('Demo login failed: '+response.status());
const page=await context.newPage();
const directory=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../screenshots');
const errors=[];page.on('pageerror',error=>errors.push(error.message));
for(const [url,file,text] of [['/','home.png','A field guide to quieter mornings'],['/b/800000000001','reading.png','Synthetic demonstration article'],['/digest','digest.png','Small discoveries, collected'],['/settings','settings.png','Appearance']]) {
 await page.setViewportSize({width:1440,height:file==='settings.png'?480:1100});
 await page.goto(base+url,{waitUntil:'networkidle'});
 await page.getByText(text,{exact:false}).first().waitFor();
 await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.complete?Promise.resolve():new Promise(resolve=>{i.onload=resolve;i.onerror=resolve;})));});
 await page.screenshot({path:path.join(directory,file),fullPage:false});
 console.log(file,await page.title());
}
await browser.close();
if(errors.length) throw new Error(JSON.stringify(errors));
console.log('Four genuine web captures saved; no browser page errors.');
