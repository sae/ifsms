load('api_config.js');
load('api_gpio.js');
load('api_mqtt.js');
load('api_net.js');
load('api_sys.js');
load('api_timer.js');
load('api_uart.js');
load('api_http.js');
load('api_ucs2.js');

//set rpc:uart:uart_no to -1 in conf0
//ws://192.168.1.183/rpc
UART.setConfig(0, {
  baudRate: 9600 }); // 9600 
UART.setRxEnabled(0, true); //must!

let led = Cfg.get('pins.led');
//let button = Cfg.get('pins.button');
//let topic = '/devices/' + Cfg.get('device.id') + '/events';

//Cfg.get('user.str1'); if you will extend config data in firmware. or hardcode this values
let ifttt_key = Cfg.get('gcp.key'); //unused config parameter


let conn1=null;//telnet connection
let uart_in="";//input from uart
let telnet_in="";//input from telnet
let timer_id=0;//timer for gsm init function
let init_step=0;//init step counter
let msg="";//message for ifttt
let modemOK=0; //init modem OK timestamp, so timer goes to boot modem

GPIO.set_mode(led, GPIO.MODE_OUTPUT);
GPIO.write(led,1); //led off

//simple output to telnet session
function t(msg1) {
  if (conn1!==null) Net.send(conn1, msg1);
}


//send event "ifsms" to ifttt
//POST does not work 
let ifttt_url="https://maker.ifttt.com/trigger/ifsms/with/key/"+ifttt_key+"?value1=";

function ifttt() {
  msg=UCS2.sms_encode(msg);
  HTTP.query({
  url: ifttt_url+msg ,
  headers: { 'X-Foo': 'bar' },     // Optional - headers
  data: { value2 : "msg" },      // Optional. If set, JSON-encoded and POST-ed
  success: function(body, full_http_msg) { t(ifttt_url+msg+"\nifttt ok\n"); },
  error: function(err) { t("ifttt error "+JSON.stringify(err)+"\n"); },  // Optional
  });
}


Net.setStatusEventHandler(function(ev, arg) {
  let evs = '???';
  if (ev === Net.STATUS_DISCONNECTED) {
    evs = 'DISCONNECTED';
  } else if (ev === Net.STATUS_CONNECTING) {
    evs = 'CONNECTING';
  } else if (ev === Net.STATUS_CONNECTED) {
    evs = 'CONNECTED';
  } else if (ev === Net.STATUS_GOT_IP) {
    evs = 'GOT_IP';
    //msg="connected"; //called too often but useless
    //ifttt();
  }
}, null);


//start modem
//make strobe to boot pin (ESP8266 pin D1, aka GPIO5)
let boot_gsm=function() {
  GPIO.set_mode(5,GPIO.MODE_OUTPUT);
  GPIO.write(5,0);
  Sys.usleep(500*1000);
  GPIO.set_mode(5,GPIO.MODE_INPUT);
};

//timer-based initialization for gsm modem (
let init_gsm=function() {
  if (init_step===0) GPIO.write(led,0);//led on
  if (init_step===0) UART.write(0,"AT\r\n"); //empty command for clear
  if (init_step===1) UART.write(0,"AT+CLIP=1\r\n"); //show caller number
  if (init_step===2) UART.write(0,"AT+CMGF=1\r\n"); //SMS format.  
  if (init_step===3) UART.write(0,"AT+CSCS=\"UCS2\"\r\n"); //SMS text
  if (init_step===4) UART.write(0,"AT+CNMI=2,2\r\n");//show sms to terminal
  init_step++;
  if (init_step > 4) {
    GPIO.write(led,1);//led off  
    Timer.del(timer_id);
    init_step=0;//clear counter so we can init the modem next time
//    t("modem init done");
    msg="modem-init-done";
    ifttt();
  }
};


/*
"\r\nMODEM:STARTUP\r\n"
"\r\n+PBREADY\r\n"
"\r\n+CMT: \"kaspi.kz\",,\"18/01/04,00:02:14+36\"\r\n???? ?? kaspi.kz c ???...\r\n"
"\r\nRING\r\n\r\n+CLIP: \"77002608317\",145,,,\"\",0\r\n"
"\r\nNO CARRIER\r\n"
"AT\r\r\nOK\r\n"
*/
let start="\r\nMODEM:STARTUP\r\n";
let pbready="\r\n+PBREADY\r\n";
let sms="\r\n+CMT: ";
let ring="\r\nRING\r\n\r\n+CLIP: \"";
let ring2="\r\nRING";
let ok="at\r\r\nOK\r\n"; //AT does not work!

UART.setDispatcher(0, function(uartNo, ud) {
  let ra = UART.readAvail(0);//disp called when no data avail
  if (ra > 0) {
    uart_in = UART.read(0);
    if (uart_in===start) { //gsm modem starting
      modemOK=Timer.now()+120; //do not check next 4 min
    } else
    if (uart_in===ok) { //gsm modem returns OK
        t("ok\n");
        modemOK=Timer.now();
    } else
    if (uart_in===pbready) { //gsm modem goes to ready state
        t("pbready\n");
        timer_id=Timer.set(2000, Timer.REPEAT, init_gsm, null); //init modem by AT commands
    } else
    if (uart_in.slice(0,sms.length)===sms) { //sms received
        msg="SMS:"+uart_in.slice(sms.length,uart_in.length-1);
        t(msg+"\n");
        ifttt();
    } else   
    if (uart_in.slice(0,ring.length)===ring) { //ring received
        msg="RING:"+uart_in.slice(ring.length,uart_in.length-1);
        t(msg+"\n");
        ifttt();
    } else   
    if (uart_in.slice(0,ring2.length)===ring) { //ring without a number, when gsm not initialized by AT commands
        msg="RING-unknown: "+uart_in;
        t(msg+"\n");
        ifttt();
    } else   { //unknown string from the modem
      t(JSON.stringify(uart_in));
    }
   }
}, null);

//telnetd is not necessary, but useful for debugging
//when telnet session established, blue led turns ON
//when session closed, led turns OFF
Net.serve({
  addr: 'tcp://23',
  onconnect: function(conn) {
    conn1=conn;//save connection handler
    GPIO.write(led,0);//led on
    Net.send(conn, "telnetd ready\n");
  },
  ondata: function(conn, data) {
    telnet_in+=data;
    Net.discard(conn, data.length);  // Discard received data
    let c=telnet_in.at(telnet_in.length - 1);
    if (c===10) { // \n - processing some commands
      if (telnet_in==="gsm\r\n") {
        t("boot gsm!\n");
        boot_gsm();
      } else
      if (telnet_in==="init\r\n") {
        t("init gsm!\n");
        timer_id=Timer.set(2000, Timer.REPEAT, init_gsm, null);//save timer so we can close it
      } else
      if (telnet_in.slice(0,2)==="at") {
        t("sent...\n");
        UART.write(0,telnet_in);
      } else
      if (telnet_in==="ifttt\r\n") {
        t("ifttt!\n");
        msg="test";
        ifttt();
      } else
      t("got: "+JSON.stringify(telnet_in)+"\n");  
    }  
    telnet_in=""; //clear input buffer
  },
  onclose: function(conn) {
    conn1=null;
    GPIO.write(led,1);//led off
  },
   // Optional. Called when on connection error.
  onerror: function(conn) {
    conn1=null;
  },
});

//prevent modem from sleep, 
//todo: check modem state? if modem goes to power off, we need to boot it again
Timer.set(60000 /* 1 min */, true /* repeat */, function() {
  UART.write(0,"at\r\n"); //empty command 
  //if modem asks OK, then uart dispatcher put timestamp to modemOK
  if (Timer.now()-modemOK > 150) { //if modem does not answer OK 150 seconds
    boot_gsm(); 
    msg="reboot-modem!";
    ifttt();
  }
}, null);

boot_gsm(); //send boot signal to modem (gsm led goes to blink)

//GPIO.toggle(led);
//Sys.usleep(500*1000);
//GPIO.toggle(led);
