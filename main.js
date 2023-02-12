var mypubkey="4c5d5379a066339c88f6e101e3edb1fbaee4ede3eea35ffc6f1c664b3a4383ee";
var relaylist=[
  "wss://relay-jp.nostr.wirednet.jp",
  "ws://localhost:6969",
//  "ws://localhost:6969",
  "wss://relay.damus.io",
];
var relays = relaylist.length;
var currelay = 0;

window.onload=function(){
  nrelay = relaylist.length;
  var ws = new Array(nrelay); // ws[r]
  var recv = new Array(nrelay); // recv[r][n][0,1,2]
  checknextrelay();
}
var ws;
var isopen;
var trialms;
var gotmsg;
var checknextrelay=function(){
  var r = currelay;
  relays = relaylist.length;
  var recv = [];
  isopen = false;
  ws = new WebSocket(relaylist[r]);
  ws.onopen = function(e){
    uuid=getuuid();
    noteid = "bd5c74ab7616fbb1396fdc959d26b654ec74d568fe494355bdbe14a9798427f2";
//      noteid = "a0bfa1f3896d2f893cdbb80a339302911465abc700a65f64a2e622d447";
    var sendobj=[
      "REQ",
      uuid,
      {
        "ids"  :[noteid],
//        "authors"  :[mypubkey],
//        "kinds":[1],
//        "limit":10
      }
    ];
    sendstr = JSON.stringify(sendobj);
    print("currelay="+currelay+"\n");
    gotmsg = false;
    trialms = 0;
    print("sent message = "+sendstr+"\n");
    ws.send(sendstr);
    isopen = true;
  };
  ws.onmessage = function(m){
    recv.push(JSON.parse(m.data));
    print("relay = "+relaylist[r]+"\n");
    print("received message = "+m.data+"\n");
    ws.close();
    gotmsg = true;
  };
  trialms = 10;
  setTimeout(checkmsg, trialms);
}
var checkmsg = function(){
  if(!gotmsg){
    trialms+=10;
    if(trialms < 5000){
      setTimeout(checkmsg, 10);
      return;
    }
  }
  currelay++;
  if(currelay==relays){
    drawresult();
  }else{
    checknextrelay();
  }
}
var drawresult = function(){
}
var print = function(m){
  f0.ta0.value += m;
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

