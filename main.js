var defaultset=function(){};
defaultset.mypubkey="4c5d5379a066339c88f6e101e3edb1fbaee4ede3eea35ffc6f1c664b3a4383ee";
defaultset.noteid="note15zl6ruufd5hcj0xmhq9r8yczjy2xt278qzn97e9zuc3dg36lkufq4326xp";
defaultset.relaylist=[
 // "ws://localhost:6969",
  "wss://relay.snort.social",
  "wss://relay.damus.io",
  "wss://offchain.pub",
  "wss://nostr-pub.wellorder.net",
  "wss://nostr-pub.semisol.dev",
  "wss://relay.current.fyi",
  "wss://relay-jp.nostr.wirednet.jp",
  "wss://nostr.h3z.jp",
  "wss://nostr-relay.nokotaro.com",
  "wss://nostr.holybea.com",
  "wss://test.relay.nostrich.day",
  "wss://relay.nostr.or.jp",
  "wss://nostr.fediverse.jp",
  "wss://nostream.ocha.one",
  "wss://relayer.ocha.one",
  "wss://nos.lol",
  "wss://nostr.relayer.se",
  "wss://nostr.shawnyeager.net/",
  "wss://global.relay.red/",
  "wss://relay.nostr.vision/",
  "wss://nostr.zkid.social/",
  "wss://relay.nostr.info",
  "wss://nostr.bingtech.tk/",
  "wss://nostr.fmt.wiz.biz",
  "wss://brb.io",
  "wss://nostr.rewardsbunny.com/",
  "wss://nostr.lnprivate.network/",
];
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
  uuid = genuuid();
  for(var r=0;r<defaultset.relaylist.length;r++){
    form0.relayliststr.value += defaultset.relaylist[r] + "\n";
  }
  form0.noteid.value = defaultset.noteid;
  form0.kind.value = 1;
  parsequery();
}
var parsequery=function(){
  const sp = new URLSearchParams(window.location.search);
  if(sp.has('noteid')){
    form0.noteid.value = sp.get('noteid');
  }
  if(sp.has('kind')){
    form0.kind.value = sp.get('kind');
  }
  if(sp.has('relay')){
    form0.relayliststr.value = sp.get('relay').replace(/;/g,"\n");
  }
}
var prevurl = "";
var makequery=function(){
  var query="";
  query += "noteid=" + form0.noteid.value;
  query += "&kind=" + form0.kind.value;
  query += "&relay=" + form0.relayliststr.value.replace(/\n/g,';');
  var url = location.origin+location.pathname+"?"+query;
  if(prevurl!=url){
    history.pushState(null,null,url);
  }
  prevurl=url;
  document.title = form0.noteid.value.substr(0,12) + " searched by nostr-post-checker";
}
var startcheckrelays=function(){
  makequery();
  iserror = false;

  /* check id */
  let n;
  if(form0.noteid.value.substr(0, 6) == "nostr:"){
    n = 6;
  }else{
    n = 0;
  }
  if(form0.noteid.value.substr(n, 4) == "note" || form0.noteid.value.substr(n, 6) == "nevent"){
    filter=["ids","id"];
  }else if(form0.noteid.value.substr(n, 4) == "npub" || form0.noteid.value.substr(n, 8) == "nprofile"){
    filter=["authors","pubkey"]
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
    ws[r] = new WebSocket(relaylist[r]);
    ws[r].uuid = uuid;
    ws[r].r = r;
    ws[r].status = "idle";
    ws[r].recv = [];
    ws[r].onerror = function(e){
      ws[this.r].status = "error";
    }
    ws[r].onmessage = function(m){
      var r=this.r;
      ws[r].recv.push(JSON.parse(m.data));
      print("received message from ws["+relaylist[r]+"]='"+m.data+"'\n");
      ws[r].close();
      ws[r].status = "received";
      drawresult(r);
    };
    ws[r].onopen = function(e){
      var r = this.r;
      print("ws["+relaylist[r]+"] was opened.\n");

      if(form0.noteid.value.substr(0, 6) == "nostr:"){
        noteObj = window.NostrTools.nip21.parse(form0.noteid.value);
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
      }else{
        noteObj = window.NostrTools.nip19.decode(form0.noteid.value);
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
      print("sent '"+sendstr+"'\n");
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
    print("curms="+curms+"\n");
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
    td0.innerHTML = relaylist[r];
    td0.setAttribute("class","tdrelay");
    tr.appendChild(td0);
    var td1 = document.createElement("td");
    td1.innerHTML = "connecting...";
    td1.setAttribute("class","tdcon");
    tr.appendChild(td1);
    ws[r].td = td1;
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
  form0.debugout.value += m;
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
