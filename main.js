var mypubkey="4c5d5379a066339c88f6e101e3edb1fbaee4ede3eea35ffc6f1c664b3a4383ee";
//var relay = "wss://relay.damus.io";
var relay = "ws://localhost:6969";
//var relay = "wss://relay.snort.social";
var ws;
var isopened = false;
var recv=[];

window.onload=function(){
  ws = new WebSocket(relay);
  ws.onmessage = onmessage;
  ws.onopen = onopen;
}

var procreq = function(){
  uu=getuuid();
  noteid = "a0bfa1f3896d2f893cdbb80a339302911465abc700a65f64a2e622d4475fb712";
  var msgobj=[
    "REQ",
    uu,
    {
      "ids"  :[noteid],
      "kinds":[1],
      "limit":10
    }
  ];
  msgstr = JSON.stringify(msgobj);
  
  ws.send(msgstr);
}

var onopen = function(e){
  isopened = true;
  procreq();
}
var onmessage = function(m){
  recv.push(JSON.parse(m.data));
  print(m.data);
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

