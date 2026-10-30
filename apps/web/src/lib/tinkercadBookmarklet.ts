import { TINKERCAD_CLIPBOARD_PREFIX, TINKERCAD_HASH_KEY } from "@/lib/tinkercadImport";

/** Above this the address gets unwieldy, so the design only goes over by Ctrl+V. */
export const TINKERCAD_HASH_LIMIT = 1_500_000;

/**
 * The script behind the "Send to Mintr" bookmark. Clicked on a design open in Tinkercad's 3D
 * editor, it reads the design's shape tree from the page, puts it on the clipboard for Ctrl+V in
 * Mintr, and (on the web) opens Mintr in a new tab with the design. It only reads the page:
 * nothing is changed in Tinkercad and nothing is uploaded.
 *
 * Kept as plain ES5-ish source: it runs inside Tinkercad's page, not Mintr's bundle.
 * Clicking a bookmark leaves focus on the bookmarks bar, and the Clipboard API refuses an
 * unfocused page, so the copy goes through a selected text box and execCommand("copy").
 */
export function tinkercadBookmarkletSource(appUrl: string | null) {
  return `(function(){
var fail=function(why){alert("Mintr could not read this design"+(why?" ("+why+")":"")+". Open the design in Tinkercad's 3D editor, wait for it to load, then click the bookmark again.");};
try{
var editor=window.adsk&&adsk.TinkercadApplication&&adsk.TinkercadApplication._editor3DContent&&adsk.TinkercadApplication._editor3DContent._editor3D;
var map=editor&&editor.root&&editor.root.objectMap&&editor.root.objectMap._content;
if(!map){fail("no design on this page");return;}
var doc=null;
for(var id in map){var v=map[id]&&map[id].val;if(v&&v.rootNode&&v.nodes){doc=v;break;}}
var rootNode=doc&&doc.rootNode&&("value" in doc.rootNode?doc.rootNode.value:doc.rootNode);
if(!rootNode||typeof rootNode.toJSON!=="function"){fail("no design on this page");return;}
var title=editor.designTitle;
if(title&&typeof title==="object"&&"value" in title)title=title.value;
if(typeof title!=="string"||!title.trim())title=String(document.title||"").replace(/\\s*[|\\-]\\s*Tinkercad.*$/i,"").replace(/^3D design\\s*/i,"");
var text=JSON.stringify({v:1,name:title.trim()||"Tinkercad design",root:rootNode.toJSON()});
var clip=${JSON.stringify(TINKERCAD_CLIPBOARD_PREFIX)}+text;
var copied=false;
try{var box=document.createElement("textarea");box.value=clip;box.setAttribute("readonly","");box.style.position="fixed";box.style.left="-9999px";box.style.top="0";document.body.appendChild(box);box.focus();box.select();copied=document.execCommand("copy");document.body.removeChild(box);}catch(e){}
if(!copied){try{if(navigator.clipboard&&document.hasFocus()){navigator.clipboard.writeText(clip);copied=true;}}catch(e){}}
var app=${JSON.stringify(appUrl)};
if(app&&text.length<=${TINKERCAD_HASH_LIMIT}){
var tab=window.open(app+"#${TINKERCAD_HASH_KEY}="+encodeURIComponent(text),"_blank");
if(tab)return;
alert(copied?"Your browser blocked the new tab. Open Mintr and press Ctrl+V to bring the design in.":"Your browser blocked the new tab. Allow pop-ups for Tinkercad, then click the bookmark again.");
return;
}
alert(copied?"Design copied. Press Ctrl+V in Mintr to bring it in.":"Mintr could not copy the design. Click on the design once, then click the bookmark again.");
}catch(e){fail(e&&e.message);}
})();`;
}

/** The bookmark's address: drag it to the bookmarks bar. */
export function tinkercadBookmarkletHref(appUrl: string | null) {
  const compact = tinkercadBookmarkletSource(appUrl).replace(/\n/g, "");
  return `javascript:${encodeURIComponent(compact)}`;
}
