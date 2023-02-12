var defaultset=function(){};
defaultset.mypubkey="4c5d5379a066339c88f6e101e3edb1fbaee4ede3eea35ffc6f1c664b3a4383ee";
defaultset.noteid="note15zl6ruufd5hcj0xmhq9r8yczjy2xt278qzn97e9zuc3dg36lkufq4326xp";
defaultset.relaylist=[
  "wss://jiggytom.ddns.net",
  "wss://eden.nostr.land",
  "wss://nostr.fmt.wiz.biz",
  "wss://relay.damus.io",
  "wss://nostr-pub.wellorder.net",
  "wss://relay.nostr.info",
  "wss://offchain.pub",
  "wss://nostr.onsats.org",
  "wss://nos.lol",
  "wss://brb.io",
  "wss://relay.snort.social",
  "wss://relay.current.fyi",
  "wss://nostr.relayer.se",
  "wss://nostr.rewardsbunny.com/",
  "wss://nostr.lnprivate.network/",
  "wss://nostr.shawnyeager.net/",
  "wss://relay-jp.nostr.wirednet.jp/",
  "wss://nostr.h3z.jp/",
  "wss://global.relay.red/",
  "wss://relay.nostr.vision/",
  "wss://nostr.zkid.social/",
  "wss://nostr.bingtech.tk/",
  //  "ws://localhost:6969",
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
var currelay;
var recv;
var cantconnect;
var notehex;

var ws;
window.onload=function(){
  for(var r=0;r<defaultset.relaylist.length;r++){
    form0.relayliststr.value += defaultset.relaylist[r] + "\n";
  }
  form0.noteid.value = defaultset.noteid;
}
var startcheckrelays=function(){
  currelay=0;
  var table=document.getElementById("result");
  while(table.firstChild){
    table.removeChild(table.firstChild);
  }
  relaylist=form0.relayliststr.value.replace(/\n\n*/g,"\n").replace(/\n$/,"").split("\n");
  relays = relaylist.length;
  ws = new Array(relays); // ws[r]
  recv = new Array(relays); // recv[r][n][0,1,2]
  cantconnect = new Array(relays);
  checknextrelay();
}
var isopen;
var trialms;
var gotmsg;
var checknextrelay=function(){
  var r = currelay;
  isopen = false;
  ws = new WebSocket(relaylist[r]);
  ws.onerror = function(e){
    cantconnect[currelay]=true;
    currelay++;
    if(currelay<relays){
      checknextrelay();
    }else{
      drawresult();
    }
  }
  ws.onopen = function(e){
    print("onopen for "+currelay+"\n");
    uuid=getuuid();
    notehex = key2hex(form0.noteid.value);
//      notehex = "a0bfa1f3896d2f893cdbb80a339302911465abc700a65f64a2e622d447";
    var sendobj=[
      "REQ",
      uuid,
      {
        "ids"  :[notehex],
//        "authors"  :[mypubkey],
//        "kinds":[1],
//        "limit":10
      }
    ];
    sendstr = JSON.stringify(sendobj);
    gotmsg = false;
    trialms = 0;
    print("currelay="+currelay+"\n");
    print("sent message = "+sendstr+"\n");
    recv[currelay]=[];
    ws.send(sendstr);
    isopen = true;
  };
  ws.onmessage = function(m){
    recv[currelay].push(JSON.parse(m.data));
    print("relay = "+relaylist[currelay]+"\n");
    print("received message = "+m.data+"\n");
    ws.close();
    gotmsg = true;
  };
  trialms = 0;
  setTimeout(checkmsg, 100);
}
var checkmsg = function(){
  if(!gotmsg){
    trialms+=100;
//    print("trialms="+trialms+"\n");
    if(trialms < 5000){
      setTimeout(checkmsg, 100);
      return;
    }else{
      print("timeout\n");
    }
  }
  gotmsg=false;
  currelay++;
//  print("currelay="+currelay+"\n");
  if(currelay==relays){
    drawresult();
  }else{
    checknextrelay();
  }
}
var drawresult = function(){
  var table = document.getElementById("result");
  for(var r=0;r<relays;r++){
    var tr = document.createElement("tr");
    table.appendChild(tr);
    var td0 = document.createElement("td");
    td0.innerHTML = relaylist[r];
    td0.setAttribute("class","resulttd");
    tr.appendChild(td0);
    var td1 = document.createElement("td");
    if(recv[r] instanceof Array && recv[r][0] instanceof Array){
      if(
        recv[r][0][0]=="EVENT" && 
        recv[r][0][2].id !==undefined &&
        recv[r][0][2].id==notehex &&
        recv[r][0][2].kind !==undefined &&
        recv[r][0][2].kind==1){
        td1.innerHTML = "exist";
      }else{
        td1.innerHTML = "not exist";
      }
    }else{
      if(cantconnect[r]==true){
        td1.innerHTML = "can't connect";
      }
    }
    td1.setAttribute("class","resulttd");
    tr.appendChild(td1);
  }
}
var print = function(m){
  form0.debugout.value += m;
}

var getuuid = function(){
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
