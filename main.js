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
window.onload=function(){
  for(var r=0;r<defaultset.relaylist.length;r++){
    form0.relayliststr.value += defaultset.relaylist[r] + "\n";
  }
  form0.noteid.value = defaultset.noteid;
}
var startcheckrelays=function(){
  while(table.firstChild){
    table.removeChild(table.firstChild);
  }
  relaylist=form0.relayliststr.value.replace(/\n\n*/g,"\n").replace(/\n$/,"").split("\n");
  relays = relaylist.length;
  ws = new Array(relays); // ws[r]
  for(var r=0;r<relays;r++){
    ws[r] = new WebSocket(relaylist[r]);
    ws[r].uuid = genuuid();
    ws[r].r = r;
    ws[r].status = "idle";
    ws[r].recv = [];
    ws[r].onerror = function(e){
      ws[this.r].status = "error";
    }
    ws[r].onopen = function(e){
      var r = this.r;
      print("ws["+relaylist[r]+"] was opened.\n");
      notehex = key2hex(form0.noteid.value);
      var sendobj=[
        "REQ",
        ws[r].uuid,
        {"ids":[notehex],"kinds":[parseInt(form0.kind.value)]}
      ];
      sendstr = JSON.stringify(sendobj);
      ws[r].send(sendstr);
      print("sent '"+sendstr+"'\n");
      ws[r].status = "sent";
    };
    ws[r].onmessage = function(m){
      var r=this.r;
      ws[r].recv.push(JSON.parse(m.data));
      print("received message from ws["+relaylist[r]+"]='"+m.data+"'\n");
      ws[r].close();
      ws[r].status = "received";
      drawresult(r);
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
  if(curms!=-1 && nextms!=-1){
    document.getElementById("time").innerHTML = " left "+Math.floor((timeout-curms)/1000)+" seconds until timeout";
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
          recv[0][2].id !==undefined &&
          recv[0][2].id==notehex &&
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

var key2hex = function(key){
  const decoded = bech32.decode(key);
	const bytes = fromWords(decoded.words);
	return hex_encode(bytes);
}
var hex_encode = function(buf){
	str = ""
	for (let i = 0; i < buf.length; i++) {
		const c = buf[i]
		str += hex_char(c >> 4)
		str += hex_char(c & 0xF)
	}
	return str
}
function hex_char(val)
{
	if (val < 10)
		return String.fromCharCode(48 + val)
	if (val < 16)
		return String.fromCharCode(97 + val - 10)
}
