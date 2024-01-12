var version = "1.29";
var debug_extension_emulated=false;
if(debug_extension_emulated){
  window.nostr = function(){};
  window.nostr.getRelays    = function(){return debug_relaylist;};
  window.nostr.getPublicKey = function(){return defaultset.mypubkey;};
  window.NostrTools = function(){};
}
var defaultset=function(){};
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
var debug_relaylist={
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
var relays;
var notehex;
var ws;
var curms=-1;
var nextms=-1;
var filter;
var iserror;
var uuid;
window.onload=function(){
  //show version
  document.getElementById('version').innerHTML=version;

  initHtml(navigator.language);
  
  var isfromquery = false;
  var isfromls    = false;

  //default settings 
  for(var r=0;r<defaultset.relaylist.length;r++){
    form0.relayliststr.value += defaultset.relaylist[r] + "\n";
  }
  form0.eid.value = defaultset.eid;
  form0.kind.value = 1;

  //try to get settings from localStorage
  var r = localStorage.getItem("settings");
  if(r!==null){
    var urlsp = new URLSearchParams(r);
    urlsp2form(urlsp);
  }

  //try to get settings from HTTP query
  var urlsp = getaddr();
  var isbyquery = urlsp2form(urlsp);
  if(isbyquery){ // does query set any form
    //auto start check
    startcheckrelays();
  }
}
var handle_copy_button=function(){
  const url = form2url();
  navigator.clipboard.writeText(url);
}
var handle_search_button=function(){
  var str=form2url();
  str="?"+str.split("?")[1];
  localStorage.setItem("settings", str);
  startcheckrelays();
}
/* return browser address */
var getaddr=function(){
  return new URLSearchParams(window.location.search);
}
/* set url into browser address, and jump. (no url, no query) */
var setaddr=function(url){
  if(url === undefined){
    url = location.origin+location.pathname;
  }
  document.title = form0.eid.value.substr(0,12) + " searched by nostr-post-checker";
  if(prevurl!=url){
    history.pushState(null,null,url);
  }
  prevurl=url;
}
var prevurl = "";
var urlsp2form=function(urlsp){
  var isset = false;
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
  return isset;
}
var form2url=function(){
  var query="";
  if(form0.eid .value!="") query += "&eid="  + form0.eid .value;
  if(form0.kind.value!="") query += "&kind=" + form0.kind.value;
  if(form0.relayliststr.value!=""){
    query += "&relay=" + form0.relayliststr.value.replace(/\n/g,';');
  }
  var url = location.origin+location.pathname+"?"+query.slice(1);
  return url;
}
var initHtml=(lang)=>{
  var ja = Array.from(document.getElementsByClassName('langja'));
  var en = Array.from(document.getElementsByClassName('langen'));
  if(lang=='ja'){
    ja.map((x)=>x.style.display='inline');
    en.map((x)=>x.style.display='none'  );
  }else{
    en.map((x)=>x.style.display='inline');
    ja.map((x)=>x.style.display='none'  );
  }
}
var showdebug = function(){
  if(form1.debugcheck.checked){
    document.getElementsByClassName('debugout')[0].style.display='block';
  }else{
    document.getElementsByClassName('debugout')[0].style.display='none';
  }
}
var startcheckrelays=function(){
  iserror = false;

  /* check id */
  let n;
  if(form0.eid.value.substr(0, 6) == "nostr:"){
    n = 6;
  }else{
    n = 0;
  }
  var ishex=false;
  if(form0.eid.value.substr(n, 4) == "note" || form0.eid.value.substr(n, 6) == "nevent"){
    filter=["ids","id"];
  }else if(form0.eid.value.substr(n, 4) == "npub" || form0.eid.value.substr(n, 8) == "nprofile"){
    filter=["authors","pubkey"]
  }else if(form0.eid.value.replace(/[a-fA-F0-9]+/g,'').length==0){
    ishex=true;
    filter=["ids","id"];
  }else{
    /* invalid id */
    iserror = true;
    document.getElementById("time").innerHTML = "Invalid id. id should start from npub or nprofile or note or nevent."
  }

  while(table.firstChild){
    table.removeChild(table.firstChild);
  }

  relaylist = form0.relayliststr.value.replace(/\n\n*/g,"\n").replace(/\n$/,"").split("\n");
  relays = relaylist.length;
  if(iserror){
    ws = new Array(relays); // ws[r]
    for(var r=0;r<relays;r++){
      ws[r] = new Object;
    }
    preparetable();
    for(var r=0;r<relays;r++){
      var td1 = ws[r].td;
      var recv = ws[r].recv;
      td1.innerHTML = "id is invalid";
      td1.setAttribute("class","tderror");
    }
    return;
  }
  ws = new Array(relays); // ws[r]
  for(var r=0;r<relays;r++){
    uuid = genuuid();
    ws[r] = new WebSocket(relaylist[r]);
    ws[r].uuid = uuid;
    ws[r].r = r;
    ws[r].status = "idle";
    ws[r].recv = [];
    ws[r].onerror = function(e){
      print("error: "+relaylist[this.r]+" :ws[r].onerror\n");
      if(ws[this.r].status != "received"){
        ws[this.r].status = "error";
      }
    }
    ws[r].onmessage = function(m){
      var r=this.r;
      print("recv : "+relaylist[this.r]+"\n");
      ws[r].recv.push(JSON.parse(m.data));
      //print("received message from ws["+relaylist[r]+"]='"+m.data+"'\n");
      ws[r].close();
      ws[r].status = "received";
      drawresult(r);
    };
    ws[r].onopen = function(e){
      var r = this.r;
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

      var eventFilter = {[filter[0]]:[notehex],"kinds":[parseInt(form0.kind.value)]};

      var sendobj=[
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
var timer;
var timeout=60000;
var checktime=function(){
  if(!iserror){
    if(curms!=-1 && nextms!=-1){
      document.getElementById("time").innerHTML = " left "+Math.floor((timeout-curms)/1000)+" seconds until timeout";
    }
  }
}
var checkmsg = function(){
  var yet=false;
  for(var r=0;r<relays;r++){
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
var drawresultall=function(){
  for(var r=0;r<relays;r++)drawresult(r);
}
var table = document.getElementById("result");
var preparetable = function(){
  for(var r=0;r<relays;r++){
    var tr = document.createElement("tr");
    table.appendChild(tr);

    var td0 = document.createElement("td");
    td0.innerHTML = "connecting...";
    td0.setAttribute("class","tdcon");
    tr.appendChild(td0);

    var td1 = document.createElement("td");
    td1.innerHTML = relaylist[r];
    td1.setAttribute("class","tdrelay");
    tr.appendChild(td1);

    ws[r].td = td0;
  }
}
var drawresult = function(r){
  var td1 = ws[r].td;
  var recv = ws[r].recv;
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
      if(recv instanceof Array && recv[0] instanceof Array){
        if(
          recv[0][0]=="EVENT" && 
          recv[0][2][filter[1]] !==undefined &&
          recv[0][2][filter[1]]==notehex &&
          recv[0][2].kind !==undefined &&
          recv[0][2].kind==parseInt(form0.kind.value)){
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

var print = function(m){
  form1.debugout.value += m;
}

var genuuid = function(){
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
      var list = await get_my_relays(kind);
      form0.relayliststr.value = "";
      for(relay of list){
        form0.relayliststr.value += relay + "\n";
      }
    }catch(e){
      form0.relayliststr.value = e;
    }
}
async function get_my_relays(kind){
  var bsrelay;
  if(window.nostr !== undefined){
    bsrelay = await window.nostr.getRelays();
  }else{
    throw "Please set NIP-07 browser extension."
  }
  var relaylist = Object.keys(bsrelay);
  var filter = [{"kinds":[kind],"authors":[await window.nostr.getPublicKey()]}];
  var resultlist = await Promise.allSettled(relaylist.map(async (url)=>{
    var result = [];

    await Promise.race([new Promise(async (resolve, reject)=>{
      var relay = window.NostrTools.relayInit(url);
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
          var rl=[];
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

