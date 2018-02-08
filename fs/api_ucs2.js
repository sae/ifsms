let UCS2 ={

//simple convert "0" to 0, "A" to 10 etc
_hexi: function (i) {
  if (i<65) { 
    return (i-48); 
  } else { 
    return (i-55); //-65 +10
  } 
},

//convert byte 10 to string "0A"
_m: ["0","1","2","3","4","5","6","7","8","9","A","B","C","D","E","F"],
_hexs: function(n) {
  //if(n>32) return chr(n);
  //if(n>15) return "-";
  if(n<0) return "*";
  let s1=this._m[Math.floor(n/16)];
  let s2=this._m[n%16];
  return ("%"+s1+s2);
},

//encode ucs-2 to url
// ucs2: "04120445043E04340020"
// return: "%D0%92%D1%85%D0%BE%D0%B4%20" 
encode: function (ucs2) {
  let res="";
  for(let i=0;i<ucs2.length-4;i+=4) {
    let i1=this._hexi(ucs2.at(i));
    let i2=this._hexi(ucs2.at(i+1));
    let i3=this._hexi(ucs2.at(i+2));
    let i4=this._hexi(ucs2.at(i+3));
    //so here we have a hex representation of 4 chars 0,4,1,2
    let a=(i1*16+i2)*256+i3*16+i4;//make an integer from 4 digits
    if(a<128) {res+=this._hexs(a) }
    else
    if (a<2048) {res+=this._hexs(((a&1984)>>>6)|192)+this._hexs((a&63)|128)}
    else{ //for other utf-16
      res="*";
    //if(a<65536){return[((a&61440)>>>12)|224,((a&4032)>>>6)|128,(a&63)|128]}  
    }
  }
  return res;
},

//special encode for ucs2 sms message
sms_encode: function (msg) {
  let t="";
  let c=0;
  let i=0;
  //encode first part, ascii and special symbols
  for (i=0; i<msg.length; i++) {
    c=msg.at(i);
    if (c===10) break; //found \n, next is ucs2 encoded text
    if (c<48) {
      t+="-";
    } else {
      t+=chr(c);
    }
  }
  //encode rest of message
  t+=this.encode(msg.slice(i+1,msg.length));
  return t;
}

}
