// Original geometric artwork and invented content for documentation captures.
// Requires Playwright in PLAYWRIGHT_MODULE and the app's normal pg dependency.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({headless:true, ...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH}: {})});
const page = await browser.newPage({viewport:{width:1200,height:700},deviceScaleFactor:1});
const media = path.join(here,'media');
await fs.mkdir(media,{recursive:true});
await fs.mkdir(path.join(root,'docs/artwork'),{recursive:true});
const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#eceaff"/><rect x="112" y="112" width="800" height="800" rx="210" fill="#4b45bd"/><path d="M352 272h320v504L512 670 352 776Z" fill="#ffffff"/><path d="M426 382h172M426 462h122" stroke="#4b45bd" stroke-width="34" stroke-linecap="round"/></svg>`;
await fs.writeFile(path.join(root,'docs/artwork/app-icon.svg'),icon);
for (const [size,dest] of [[1024,'ios/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png'],[128,'web/extension/icons/icon128.png'],[48,'web/extension/icons/icon48.png'],[16,'web/extension/icons/icon16.png']]) {
  await page.setViewportSize({width:size,height:size});
  await page.setContent(`<style>html,body{margin:0}svg{width:100vw;height:100vh}</style>${icon}`);
  await page.screenshot({path:path.join(root,dest)});
}
await page.setViewportSize({width:1200,height:700});
const colors = [['#e5ece7','#a4b8aa','#486353','#f5df9b'],['#e7e9f7','#a1addb','#4b568f','#f2bb93'],['#f2e6d9','#c79d78','#806047','#f7d6a0'],['#e2eeee','#8cb8bd','#335a68','#eed49e'],['#eee6f3','#b7a0ce','#715187','#f6d49e'],['#e7edf3','#9fb7d0','#476a91','#f5caa2']];
for (let i=0;i<colors.length;i++) {
  const [sky,hill,front,sun]=colors[i];
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700" viewBox="0 0 1200 700"><rect width="1200" height="700" fill="${sky}"/><circle cx="${850-i*75}" cy="210" r="112" fill="${sun}"/><path d="M0 520 270 260 600 540 900 320 1200 570v130H0Z" fill="${hill}"/><path d="M0 620Q330 330 620 580T1200 470v230H0Z" fill="${front}"/><path d="M0 680Q400 520 740 640T1200 600v100H0Z" fill="${sky}" opacity=".35"/></svg>`;
  await fs.writeFile(path.join(media,`landscape-${i+1}.svg`),svg);
  await page.setContent(`<style>html,body{margin:0}</style>${svg}`);
  await page.screenshot({path:path.join(media,`landscape-${i+1}.png`)});
}
await browser.close();
if(process.env.XBKMRK_DEMO_DATABASE!=='1') { console.log('Original artwork generated; database untouched.'); process.exit(0); }
const connectionString=process.env.SCREENSHOT_DATABASE_URL;
if(!connectionString || !['localhost','127.0.0.1'].includes(new URL(connectionString).hostname)) throw new Error('Use an explicitly selected disposable localhost database.');
const require=createRequire(path.join(root,'web/package.json'));
const {Pool}=require('pg');const pool=new Pool({connectionString});
if(Number((await pool.query('select count(*) from bookmarks')).rows[0].count)!==0) throw new Error('Refusing to seed a nonempty archive.');
const titles=['A field guide to quieter mornings','Designing a small community garden','Notes from a weekend telescope','A library of everyday color','A better route through the neighborhood','Making room for small ideas'];
const tags=[['demo','nature'],['demo','design'],['demo','science'],['demo','design'],['demo','outdoors'],['demo','reading']];
const descriptions=['Simple observations, a little fresh air, and a notebook by the window.','A shared patch of green, planned around sunlight, seasons, and conversation.','An imaginary evening under a clear sky, with a few bright things to notice.','Collecting a palette from ordinary places: stone, leaves, paper, and morning light.','A fictional walking guide built around quieter streets and familiar landmarks.','A short reflection on saving interesting things and finding them again.'];
for(let i=0;i<6;i++) {
 const id=String(800000000001+i),url=`https://example.com/demo/${i+1}`;
 await pool.query('insert into authors(id,username,name) values($1,$2,$3)',[i+1,`demo_editor_${i+1}`,'Demo Editorial']);
 await pool.query(`insert into bookmarks(id,author_id,text,is_long,created_at,saved_at,notes,tags,urls,metrics,raw,source,bookmarked,liked) values($1,$2,$3,false,'2026-01-12T10:00:00Z',$4,$5,$6,$7,'{}','{}','web',true,false)`,[id,i+1,`Demo: ${titles[i]}\n\n${descriptions[i]}`,`2026-01-${18-i}T12:00:00Z`,'Synthetic demonstration entry. No real reading history.',tags[i],JSON.stringify([{expanded_url:url,display_url:'example.com'}])]);
 const content=`<h1>${titles[i]}</h1><p><em>Synthetic demonstration article. Written for this screenshot; no real bookmark or third-party article is reproduced.</em></p><p>${descriptions[i]}</p><h2>Start with one good observation</h2><p>Give the idea a little space. Write down what caught your attention, choose a useful tag, and return when you have time to explore.</p><blockquote>A small collection can be a starting point for something new.</blockquote><h2>Keep the next step simple</h2><p>Read slowly, save what matters, and let curiosity choose the next page.</p>`;
 await pool.query(`insert into link_content(bookmark_id,url,kind,title,site_name,description,og_image_path,content,status) values($1,$2,'article',$3,'Synthetic Demo Library',$4,$5,$6,'ok')`,[id,url,titles[i],descriptions[i],`landscape-${i+1}.png`,content]);
}
const content={headline:'Small discoveries, collected — a synthetic edition',editorsNote:'Every article, author, date, and count in this edition is invented for the demo. A few quiet ideas about nature, design, and the things worth revisiting.',lead:{id:'800000000001',summary:descriptions[0]},sections:[{title:'Ideas to return to',lede:'Original demo writing, collected in one place.',posts:[{id:'800000000002',summary:descriptions[1]},{id:'800000000003',summary:descriptions[2]}]}],likes:[],archive:{id:'800000000004'},stats:{total:6,bookmarks:6,likes:0,videos:0,photos:0,links:6,topTags:[{tag:'demo',count:6},{tag:'design',count:2}],topAuthor:{username:'demo_editor_1',count:1}},omitted:2};
await pool.query(`insert into digests(period_start,period_end,generated_at,content) values('2026-01-12T00:00:00Z','2026-01-18T23:00:00Z','2026-01-19T12:00:00Z',$1)`,[JSON.stringify(content)]);
await pool.query(`insert into app_settings(key,value) values ('SYNC_ON_ACCESS_HOURS','0') on conflict(key) do update set value=excluded.value`);
await pool.end();console.log('Seeded six explicitly synthetic bookmarks in the empty demo database.');
