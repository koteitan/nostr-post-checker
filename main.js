const version = "1.45";
const debug_extension_emulated=false;
if(debug_extension_emulated){
  window.nostr = function(){};
  window.nostr.getRelays    = function(){return debug_relaylist;};
  window.nostr.getPublicKey = function(){return defaultset.mypubkey;};
  window.NostrTools = function(){};
}

// Utility function to parse kind input string into array of numbers
const parseKinds = function(kindStr) {
  if (!kindStr.trim()) return [];
  // Split by comma or space and filter out empty strings
  return kindStr.split(/[,\s]+/)
    .filter(k => k.trim() !== '')
    .map(k => parseInt(k.trim()))
    .filter(k => !isNaN(k));
};

const defaultset=function(){};
defaultset.mypubkey="4c5d5379a066339c88f6e101e3edb1fbaee4ede3eea35ffc6f1c664b3a4383ee";
defaultset.eid="note15zl6ruufd5hcj0xmhq9r8yczjy2xt278qzn97e9zuc3dg36lkufq4326xp";
defaultset.relaylist=[// cf. https://docs.google.com/spreadsheets/d/16PPbdUiGhcgsSmZueio3CbjF95_11sKDgOGN0r9LBJ0/edit#gid=0
 // "ws://localhost:6969",
 // global relays (that are supported by more than 2 clients on 2023/8/6)
  "wss://nos.lol",
  "wss://relay.damus.io",
//  "wss://eden.nostr.land",
  "wss://relay.snort.social",
  "wss://nostr-pub.wellorder.net",
  "wss://relay.nostr.band",
 // japanese relay (that are supported by more than 2 clients on 2023/8/6)
  "wss://yabu.me",
  "wss://relay-jp.nostr.wirednet.jp",
  "wss://nostr-relay.nokotaro.com",
  "wss://nostr.holybea.com",
];
const debug_relaylist={
  "wss://yabu.me"                :{read:true, write:true},
  "wss://nostr1.tunnelsats.com"  :{read:true, write:true},
  "wss://nostr-01.bolt.observer" :{read:true, write:true},
  "wss://nostr-pub.wellorder.net":{read:true, write:true},
  "wss://nostr-relay.wlvs.space" :{read:true, write:true},
  "wss://nostr.bitcoiner.social" :{read:true, write:true},
  "wss://relay.damus.io"         :{read:true, write:true},
//  "wss://relay.nostr.info"       :{read:true, write:true},
  "wss://relayer.fiatjaf.com"    :{read:true, write:true},
};//alby
if(false){
  defaultset.relaylist=[
    "ws://localhost:6969",
    "ws://localhost:6969",
    "ws://localhost:6969",
    "ws://localhost:6969",
    "ws://localhost:6969",
    "ws://localhost:6969",
  ];
}
let relays;
let notehex;
let ws;
let curms=-1;
let nextms=-1;
let filter;
let iserror;
let uuid;
window.onload=function(){
  //show version
  document.getElementById('version').innerHTML=version;

  initHtml(navigator.language);
  
  let isfromquery = false;
  let isfromls    = false;

  //default settings 
  for(let r=0;r<defaultset.relaylist.length;r++){
    form0.relayliststr.value += defaultset.relaylist[r] + "\n";
  }
  form0.eid.value = defaultset.eid;
  form0.kind.value = 1;

  //try to get settings from localStorage
  const r = localStorage.getItem("settings");
  if(r!==null){
    const urlsp = new URLSearchParams(r);
    urlsp2form(urlsp);
  }

  //try to get settings from HTTP query
  const urlsp = getaddr();
  const isbyquery = urlsp2form(urlsp);
  if(isbyquery){ // does query set any form
    //auto start check
    startcheckrelays();
  }
  showform();
  showpv();
}
const handle_copy_button=function(){
  const url = form2url();
  navigator.clipboard.writeText(url);
}
const handle_search_button=function(){
  let str=form2url();
  str="?"+str.split("?")[1];
  localStorage.setItem("settings", str);
  startcheckrelays();
  
  // Only scroll to result for portrait mode smartphones
  if (window.innerHeight > window.innerWidth) {
    const resultElement = document.getElementById("time");
    if (resultElement) {
      // Fast enough but still noticeable scroll speed
      resultElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
      
      // Temporarily apply custom styles to control scroll speed
      document.documentElement.style.scrollBehavior = 'smooth';
      document.documentElement.style.scrollDuration = '200ms';
      
      // Reset styles after scrolling
      setTimeout(function() {
        document.documentElement.style.scrollBehavior = '';
        document.documentElement.style.scrollDuration = '';
      }, 300);
    }
  }
}
/* return browser address */
const getaddr=function(){
  return new URLSearchParams(window.location.search);
}
/* set url into browser address, and jump. (no url, no query) */
const setaddr=function(url){
  if(url === undefined){
    url = location.origin+location.pathname;
  }
  document.title = form0.eid.value.substr(0,12) + " searched by nostr-post-checker";
  if(prevurl!=url){
    history.pushState(null,null,url);
  }
  prevurl=url;
}
let prevurl = "";
const urlsp2form=function(urlsp){
  let isset = false;
  if(urlsp.has('hidepv')){
    form1.pvcheck.checked = false;
  }else{
    form1.pvcheck.checked = true;
  }
  if(urlsp.has('hideform')){
    form1.formcheck.checked = false;
  }else{
    form1.formcheck.checked = true;
  }
  if(urlsp.has('eid')){
    form0.eid.value = urlsp.get('eid');
    isset = true;
  }else if(urlsp.has('noteid')){ // support old version
    form0.eid.value = urlsp.get('noteid');
    isset = true;
  }
  if(urlsp.has('kind')){
    form0.kind.value = urlsp.get('kind');
    isset = true;
  }
  if(urlsp.has('relay')){
    form0.relayliststr.value = urlsp.get('relay').replace(/;/g,"\n");
    isset = true;
  }
  if(urlsp.has('disableid')){
    form0.eidcheck.checked = false;
  }
  if(urlsp.has('disablekind')){
    form0.kindcheck.checked = false;
  }
  return isset;
}
const form2url=function(){
  let query="";
  if(!form1.formcheck.checked) query += "&hideform";
  if(!form1.pvcheck  .checked) query += "&hidepv";
  if( form0.eid .value!=""   ) query += "&eid="  + form0.eid .value;
  if( form0.kind.value!=""   ) query += "&kind=" + form0.kind.value;
  if( form0.relayliststr.value!=""){
    query += "&relay=" + form0.relayliststr.value.replace(/\n/g,';');
  }
  if(!form0.eidcheck.checked) query += "&disableid";
  if(!form0.kindcheck.checked) query += "&disablekind";
  const url = location.origin+location.pathname+"?"+query.slice(1);
  return url;
}
const initHtml=(lang)=>{
  let ja = Array.from(document.getElementsByClassName('langja'));
  let en = Array.from(document.getElementsByClassName('langen'));
  if(lang=='ja'){
    ja.map((x)=>x.style.display='inline');
    en.map((x)=>x.style.display='none'  );
  }else{
    en.map((x)=>x.style.display='inline');
    ja.map((x)=>x.style.display='none'  );
  }
}
const showform = function(){
  let e = Array.from(document.getElementsByClassName('inputform'));
  if(form1.formcheck.checked){
    e.map(x=>{x.style.display='block';});
  }else{
    e.map(x=>{x.style.display='none';});
  }
}
const showpv = function(){
  let e = Array.from(document.getElementsByClassName('divpvnote'));
  if(form1.pvcheck.checked){
    e.map(x=>{x.style.display='block';});
  }else{
    e.map(x=>{x.style.display='none';});
  }
}
const showdebug = function(){
  let e = Array.from(document.getElementsByClassName('debugout'));
  if(form1.debugcheck.checked){
    e.map(x=>{x.style.display='block';});
  }else{
    e.map(x=>{x.style.display='none';});
  }
}
const startcheckrelays=function(){
  /* clear websockets */
  if(ws !==undefined && Array.isArray(ws)){
    for(let r=0;r<ws.length;r++){
      if(ws[r].readyState == 0 || ws[r].readyState == 1){
        try{
          ws[r].close();
          print("closed by startcheckrelays(): "+relaylist[r]+"\n");
        }catch(e){
          print("error on startcheckrelays(): ws[r].close(): "+e+": "+relaylist[r]+"\n");
        }
      }
    }
  }
  relaylist = form0.relayliststr.value.replace(/\n\n*/g,"\n").replace(/\n$/,"").split("\n");
  relays = relaylist.length;

  /* clear UIs */
  while(table.firstChild){
    table.removeChild(table.firstChild);
  }
  update_pvprof("","","");
  pvproftime = 0;
  pvnotetime = 0;

  /* check id */
  iserror = false;
  let n;
  let ishex = false;
  
  // Empty event id case
  if(form0.eid.value.trim() === "") {
    filter = ["", ""];  // Empty filter will not be applied
    notehex = "";
    ishex = false;
  } else if(form0.eid.value.substr(0, 6) == "nostr:"){
    n = 6;
  }else{
    n = 0;
  }
  if(form0.eid.value.trim() !== "" && (
     form0.eid.value.substr(n, 4) == "note" 
     || form0.eid.value.substr(n, 6) == "nevent")){
    filter=["ids","id"];
  }else if(form0.eid.value.substr(n, 4) == "npub"
        || form0.eid.value.substr(n, 8) == "nprofile"){
    filter=["authors","pubkey"]
  }else if(form0.eid.value.replace(/[a-fA-F0-9]+/g,'').length==0){
    ishex=true;
    filter=["ids","id"];
  }else{ /* invalid id */
    iserror = true;
    document.getElementById("time").innerHTML = "Invalid id. id should start from npub or nprofile or note or nevent."
  }

  /* handle id error */
  if(iserror){
    ws = new Array(relays); // ws[r]
    for(let r=0;r<relays;r++){
      ws[r] = new Object;
    }
    preparetable();
    for(let r=0;r<relays;r++){
      let td1 = ws[r].td;
      let recv = ws[r].recv;
      td1.innerHTML = "id is invalid";
      td1.setAttribute("class","tderror");
    }
    return;
  }

  /* open websockets */
  ws = new Array(relays); // ws[r] = websocket for relay r
  for(let r=0;r<relays;r++){
    uuid = genuuid();
    ws[r] = new WebSocket(relaylist[r]); /* websocket */
    ws[r].uuid = uuid;
    ws[r].r = r;
    ws[r].status = "idle";
    ws[r].recv = [];
    ws[r].prof_search_state = "idle";
    ws[r].onerror = function(e){
      print("error: ws[r].onerror: "+relaylist[this.r]+"\n");
      if(ws[this.r].status != "received"){
        ws[this.r].status = "error";
      }
    }
    ws[r].onmessage = function(m){
      let r=this.r;
      //print("received message from ws["+relaylist[r]+"]='"+m.data+"'\n");
      let e=JSON.parse(m.data);
      ws[r].recv.push(e);
      let isfinished = false;
      if(e[0]=='EVENT'){
        print("event: "+relaylist[r]+"\n");
        pvevent(e[2], ws[r]);
        isfinished = true;
      }else if(e[0]=='EOSE'){
        print("eose : "+relaylist[r]+"\n");
        isfinished = true;
      }else{
        print(e[0]+" : "+relaylist[r]+"\n");
      }
      if(isfinished){
        ws[r].status = "received";
        ws[r].close();
        drawresult(r);
      }
    };
    ws[r].onopen = function(e){
      let r = this.r;
      print("open : "+relaylist[this.r]+"\n");
      //print("ws["+relaylist[r]+"] was opened.\n");
      //making notehex
      if(form0.eid.value.substr(0, 6) == "nostr:"){
        noteObj = window.NostrTools.nip21.parse(form0.eid.value);
        switch(noteObj.decoded.type){
          case "note":
          case "npub":
            notehex = noteObj.decoded.data;
            break;
          case "nevent":
            notehex = noteObj.decoded.data.id;
            break;
          case "nprofile":
            notehex = noteObj.decoded.data.pubkey;
            break;
        }
      }else if(ishex){
          notehex = form0.eid.value;
      }else{
        noteObj = window.NostrTools.nip19.decode(form0.eid.value);
        switch(noteObj.type){
          case "note":
          case "npub":
            notehex = noteObj.data;
            break;
          case "nevent":
            notehex = noteObj.data.id;
            break;
          case "nprofile":
            notehex = noteObj.data.pubkey;
            break;
        }
      }

      let eventFilter = {};
      // Add id/author filter only if event id is checked and not empty
      if (form0.eidcheck.checked && filter[0] !== "" && notehex !== "") {
        eventFilter[filter[0]] = [notehex];
      }
      // Add kinds filter only if kind is checked and not empty
      if (form0.kindcheck.checked) {
        const kinds = parseKinds(form0.kind.value);
        if (kinds.length > 0) {
          eventFilter.kinds = kinds;
        }
      }

      let sendobj=[
        "REQ",
        ws[r].uuid,
        eventFilter  
      ];
      sendstr = JSON.stringify(sendobj);
      ws[r].send(sendstr);
      //print("sent '"+sendstr+"'\n");
      ws[r].status = "sent";
    };
  }
  preparetable();
  curms = 0;
  nextms = 200;
  setTimeout(checkmsg, nextms);
  timer=setInterval(checktime, nextms);
}
let timer;
let timeout=60000;
const checktime=function(){
  if(!iserror){
    if(curms!=-1 && nextms!=-1){
      document.getElementById("time").innerHTML = " left "+Math.floor((timeout-curms)/1000)+" seconds until timeout";
    }
  }
}
const checkmsg = function(){
  let yet=false;
  for(let r=0;r<relays;r++){
    if(ws[r].status=="idle" || ws[r].status=="sent"){
      yet=true;
    }
  }
  if(yet){
    curms += nextms;
    //print("curms="+curms+"\n");
    if(curms+nextms<timeout){
      setTimeout(checkmsg, nextms);
      return;
    }
  }
  clearInterval(timer);
  curms = -1;
  nextms = -1;
  drawresultall();
}
const drawresultall=function(){
  for(let r=0;r<relays;r++)drawresult(r);
}
const table = document.getElementById("result");
const preparetable = function(){
  for(let r=0;r<relays;r++){
    let tr = document.createElement("tr");
    table.appendChild(tr);

    let td0 = document.createElement("td");
    td0.innerHTML = "connecting...";
    td0.setAttribute("class","tdcon");
    tr.appendChild(td0);

    let td1 = document.createElement("td");
    td1.innerHTML = relaylist[r];
    td1.setAttribute("class","tdrelay");
    tr.appendChild(td1);

    ws[r].td = td0;
  }
}
const drawresult = function(r){
  let td1 = ws[r].td;
  let recv = ws[r].recv;
  let last = recv.length-1;
  print("status = "+ws[r].status+" : "+relaylist[r]+"\n");
  switch(ws[r].status){
    case "idle":
      td1.innerHTML = "can't open";
      td1.setAttribute("class","tderror");
      break;
    case "error":
      td1.innerHTML = "error to open";
      td1.setAttribute("class","tderror");
      break;
    case "sent":
      td1.innerHTML = "no reply";
      td1.setAttribute("class","tderror");
      break;
    case "received":
    default:
      if(recv instanceof Array && recv[last] instanceof Array){
        if(
          recv[last][0]=="EVENT" && 
          // event id filter only if checked and not empty
          (!form0.eidcheck.checked || filter[0] === "" || notehex === "" || 
           (recv[last][2][filter[1]] !==undefined && recv[last][2][filter[1]]==notehex)) &&
          // kind filter only if checked and not empty
          (!form0.kindcheck.checked || form0.kind.value.trim() === "" || 
           (recv[last][2].kind !==undefined && parseKinds(form0.kind.value).includes(recv[last][2].kind)))){
          td1.innerHTML = "exist";
          td1.setAttribute("class","tdexist");
        }else{
          td1.innerHTML = "not exist";
          td1.setAttribute("class","tdnotexist");
        }
      }else{
        td1.innerHTML = "empty reply";
        td1.setAttribute("class","tderror");
        break;
      }
  }
}

const print = function(m){
  form1.debugout.value += m;
}

const genuuid = function(){
  let chars = "xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx".split("");
  for (let i = 0, len = chars.length; i < len; i++) {
    switch (chars[i]) {
      case "x":
        chars[i] = Math.floor(Math.random() * 16).toString(16);
        break;
      case "y":
        chars[i] = (Math.floor(Math.random() * 4) + 8).toString(16);
        break;
    }
  }
  return chars.join("");
}
put_my_relays = async function(kind){
    form0.relayliststr.value = "wait for your relays...";
    try{
      let list = await get_my_relays(kind);
      form0.relayliststr.value = "";
      for(relay of list){
        form0.relayliststr.value += relay + "\n";
      }
    }catch(e){
      document.getElementById("time").innerHTML = e;
    }
}
async function get_my_relays(kind){
  let bsrelay = defaultset.relaylist; // Use default relay list
  let publicKey;
  if(window.alby !== undefined) {
    publicKey = await window.alby.nostr.getPublicKey();
  } else if(window.nostr !== undefined){
    publicKey = await window.nostr.getPublicKey();
  } else {
    throw "Please set NIP-07 browser extension or Alby extension.";
  }

  let relaylist = bsrelay;
  let filter = [{"kinds":[kind],"authors":[publicKey]}];
  let resultlist = await Promise.allSettled(relaylist.map(async (url)=>{
    let result = [];

    await Promise.race([new Promise(async (resolve, reject)=>{
      let relay = window.NostrTools.relayInit(url);
      relay.on("error",()=>{
        reject();
      });
      try{
        await relay.connect();
        sub = relay.sub(filter);
        resolve();
      }catch{
        return new Promise((resolve)=>{resolve([]);});
      }
    }),new Promise((resolve,reject)=>{
      setTimeout(reject, 1000);
    })]).catch(err=>{return new Promise((resolve)=>{resolve([]);});});

    return new Promise((resolve)=>{
      setTimeout(()=>resolve(result), 3000);
      sub.on("event",(ev)=>{
        if(kind==3){
          result.push({
            time     :ev.created_at,
            relaylist:Object.keys(JSON.parse(ev.content)),
            origin   :url,
          });
        }else if(kind==10002){
          let rl=[];
          for(t of ev.tags){
            rl.push(t[1]);
          }
          result.push({
            time     :ev.created_at,
            relaylist:rl,
            origin   :url,
          });
        }
      });
      sub.on("eose",()=>{
        console.log("found:"+url);
        resolve(result);
        });
    });
  })).then(results=>{
    console.log("debug:-------");
    latest = {time:0, relaylist:defaultset.relaylist};
    for(r1 of results){
      if(r1.status=='rejected')continue;
      for(r2 of r1.value){
        if(r2.time > latest.time){
          latest = r2;
        }
      }
    }
    return latest.relaylist;
  });
  return resultlist;
}
/* try to preview the content and time of event e. */
let pvnotetime = 0;
const pvevent = function(e, ws){
  //update note
  if(e.created_at !== undefined && e.created_at > pvnotetime){
    pvnotetime = e.created_at;
    let str = "";
    pvtime.innerHTML = new Date(e.created_at*1000);
    if(e.content !== undefined) str += escape_html(e.content).replace(/\n/g,"<br>");
    pvnote.innerHTML = str;
  }
  //update profile
  if(e.pubkey !== undefined && ws.prof_search_state=="idle") search_prof(e, ws);
}
let pvproftime = 0;
const search_prof = function(e, ws0){
  ws0.prof_search_state = "opening";
  let ws = new WebSocket(relaylist[ws0.r]); /* websocket */
  ws.uuid = genuuid();
  ws.onerror = function(e){
    print("error: "+relaylist[ws0.r]+" :search_profile:ws.onerror\n");
  };
  ws.onmessage = function(m){ /* got kind:0 */
    let recv=JSON.parse(m.data);
    let reqclose = false;
    if(recv[0]=="EVENT" && recv[2].created_at > pvproftime){
      pvproftime = recv[2].created_at;
      if(recv[2].content !== undefined){
        let content = JSON.parse(recv[2].content);
        let name  = "";
        let dname = "";
        let pic   = "";
        if(content.name         !== undefined) name  = content.name;
        else name = "";
        if(content.display_name !== undefined) dname = content.display_name;
        else dname = "";
        if(content.picture      !== undefined) pic   = content.picture;
        else pic = "";
        update_pvprof(name, dname, pic);
        ws0.prof_search_state = "found";
        reqclose = true;
        print("profile: found: "+relaylist[ws0.r]+"\n");
      }
    }else if(recv[0]=="EOSE"){
      reqclose = true;
      print("profile: eose: "+relaylist[ws0.r]+"\n");
    }
    if(reqclose){
      let sentobj = ["CLOSE", ws.uuid];
      let sentstr = JSON.stringify(sentobj);
      ws.send(sentstr); /* websocket */
      ws.close(); /* websocket */
      ws0.prof_search_state = "closed";
      print("profile: closed: "+relaylist[ws0.r]+"\n");
    }
  };
  ws.onopen = function(recv){ /* opened */
    let filter ={"authors":[e.pubkey],"kinds":[0]};
    let sentobj=["REQ", ws.uuid, filter];
    let sentstr = JSON.stringify(sentobj);
    ws0.prof_search_state = "requesting";
    ws.send(sentstr); /* websocket */
    print("profile: opened: "+relaylist[ws0.r]+"\n");
  };
}
const update_pvprof = function(name, dname, pic){
  if(pic!=""){
    imgicon.setAttribute("src", pic);
    imgicon.style.display = "inline";
  }else{
    imgicon.style.display = "none";
  }
  if(name  != "") pvname .innerHTML = "(@"+escape_html(name)+")";
  if(dname != "") pvdname.innerHTML = escape_html(dname);
  
}
const escape_html = function(s){
  if(typeof s !== 'string') {
    return s;
  }
  return s.replace(/[&'`"<>]/g, function(match) {
    return {
      '&': '&amp;',
      "'": '&#x27;',
      '`': '&#x60;',
      '"': '&quot;',
      '<': '&lt;',
      '>': '&gt;',
    }[match]
  });
}
