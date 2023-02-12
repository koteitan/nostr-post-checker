var mypubkey="4c5d5379a066339c88f6e101e3edb1fbaee4ede3eea35ffc6f1c664b3a4383ee";
var relay = "wss://relay.damus.io";
var con;

window.onload=function(){
  con = new WebSocket(relay);
  con.onmessage = recvmsg;
}

var procreq = function(){
  uu=getuuid();
  con.send('["REQ","'+uu+'",{"authors":["'+mypubkey+'"],"kinds":[1],"limit":10}]');
}
var x;
var recvmsg = function(m){
  x=m;
  f0.ta0.value += m.data;
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

