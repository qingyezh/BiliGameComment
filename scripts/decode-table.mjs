const table = [
  "BMvLzfjPC2S","y29Kzq","zgv0ywLSl2DLDf92AwrLB192mG","yxnZAwDU","mtC1oteZvK5mBvjV","yxbWA2v5","DxnLCL9Hz2vUDa","zgv0ywLSl2HVDf92AwrLBW","BM93","ywPHEa","A2v5CW","C3rYAw5NAwz5","y2fJAgu","yM9KEq","CgXHDgzVCM0","6k+35Rgc5BYc5BI4lw5VDc1Zzw5K","DgLTzw91Da","mtuWotuWmMTvsxPNrq","B2jQzwn0","y2f0y2G","CMLZA0nVBNrYB2W","q29UDgvUDc1uExbL","ywPHEevYCM9YrNvUigvYCM9YoG","Aw5KzxHpzG","lY9SAw5LmY1Ons1WyY1HCgKUyMLSAwDHBwuUy29T","B3bLBG","y29UC3rYDwn0B3i","we1mshr0CfjLCxvLC3q","6k+35Rgc5BYc5BI4","zMfPBa","CgfYyw1Z","qMrPstKYyMPTwJLruMnQsKjxDJjfrxnZEwPLA0fhs3q","EgHY","zgf0yq","nePwwxPWEa","rgvKzvvZzxjjra","CMvZCg9UC2u","BgvUz3rO","C3rHCNrZv2L0Aa","B25YzwfKExn0yxrLy2HHBMDL","y29Uy2f0","zNvUy3rPB24","DxrPBhm","AxrLCMf0B3i","ue9tva","mtGZmKTdtuPmvW","y2fUqMf0y2HuzwnOuMvWB3j0","x19nsvjst1jFuKvqt1jux18","Bwv0Ag9K","zg9Uzq","CMvHzhLtDgf0zq","mtC3mhnYALLfwa","D2L0AenYzwrLBNrPywXZ","Bg9JywXLq29TCgfYzq","CMvXDwvZDf9Pza","yMLSAv9Qy3q","C3rHDhvZvgv4Da","CMfUzg9T","CM91BMq","Ahr0CdO","DxnLCKfNzw50","C29Tzq","mtaZndvhEgTSDhe","sevbra","C3rHDhvZ","C2LNBG","Ag9Tzs9JB2XSzwn0Aw9Ul3rVCa","y29Yzq","qxbPvxrPBc5JywXSoIa","AxnbCNjHEq","yxbWBgLJyxrPB24VEc13D3CTzM9YBs11CMXLBMnVzgvKoYbJAgfYC2v0pvvurI04","zM9YrwfJAa","Ahr0Chm6","C2vUza","C3LTyM9S","BxnN","y29TBwvUDc9OB3q","ode3ndbqt2rpzeG","mti2CLLbyNb5","mJa1odCXn2P1zuzesG","r0vu","y3nYzL90B2TLBG","ChjVDg9JB2W","lY9SAw5Lms1Ons1WyY1HCgKUyMLSAwDHBwuUy29T","y29TBwvUDc9NzxrwAwrLBW","B25LCNjVCG","C2XPy2u","rw52","mJy0zMTcDNDe","zgv0ywLSl2DHBwvFDMLKzw8","mJq4ndeZCNvsEurf","zxjYB3i","mtqXmJzOz3LVDeS"
];

const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=";

// Exact port of Ke.LgcJuQ
function LgcJuQ(t) {
  let e, n, r = "", i = "", o = 0, a = 0;
  // for(init; n=t.charAt(a++); increment) body
  for (; (n = t.charAt(a++)); ) {
    // body
    n = alphabet.indexOf(n);
    // increment expression
    if (~n && ((e = o % 4 ? 64 * e + n : n), o++ % 4)) {
      r += String.fromCharCode(255 & (e >> ((-2 * o) & 6)));
    }
  }
  for (let s = 0, c = r.length; s < c; s++) {
    i += "%" + ("00" + r.charCodeAt(s).toString(16)).slice(-2);
  }
  return decodeURIComponent(i);
}

function decodeOne(s) {
  try {
    return LgcJuQ(s);
  } catch (e) {
    return `ERR:${e.message}:${s}`;
  }
}

function rotate(arr, n) {
  const a = arr.slice();
  for (let i = 0; i < n; i++) a.push(a.shift());
  return a;
}

function checksum(arr) {
  const e = (t) => decodeOne(arr[t - 221]);
  const pi = (t) => parseInt(e(t), 10);
  // 423222==-parseInt(e(242))/1+parseInt(e(255))/2+parseInt(e(224))/3*(-parseInt(e(272))/4)+-parseInt(e(300))/5*(parseInt(e(289))/6)+parseInt(e(237))/7*(parseInt(e(283))/8)+parseInt(e(223))/9*(parseInt(e(222))/10)+-parseInt(e(235))/11*(parseInt(e(233))/12)
  return (
    -pi(242) / 1 +
    pi(255) / 2 +
    (pi(224) / 3) * (-pi(272) / 4) +
    (-pi(300) / 5) * (pi(289) / 6) +
    (pi(237) / 7) * (pi(283) / 8) +
    (pi(223) / 9) * (pi(222) / 10) +
    (-pi(235) / 11) * (pi(233) / 12)
  );
}

console.log("sample decode of table[0]:", JSON.stringify(decodeOne(table[0])));
console.log("sample decode of table[1]:", JSON.stringify(decodeOne(table[1])));

let found = -1;
for (let r = 0; r < table.length; r++) {
  const arr = rotate(table, r);
  try {
    const c = checksum(arr);
    if (Math.abs(c - 423222) < 0.01) {
      found = r;
      console.log("Found rotation", r, "checksum", c);
      break;
    }
    if (r < 5) console.log("rotation", r, "checksum", c);
  } catch (e) {
    if (r < 5) console.log("rotation", r, "ERR", e.message);
  }
}

if (found < 0) {
  console.log("No exact checksum match. Brute force showing all rotations for key indices.");
}

const arr = found >= 0 ? rotate(table, found) : table;
const e = (t) => decodeOne(arr[t - 221]);

const keys = [];
for (let k = 221; k <= 313; k++) keys.push(k);

for (const k of keys) {
  try {
    console.log(`Ke(${k}) = ${JSON.stringify(e(k))}`);
  } catch (err) {
    console.log(`Ke(${k}) ERR ${err.message}`);
  }
}

// Also try all rotations and print Ke(225), Ke(243), Ke(269), Ke(303) which we care about
console.log("\n=== key fields across rotations ===");
for (let r = 0; r < table.length; r++) {
  const a = rotate(table, r);
  const ee = (t) => decodeOne(a[t - 221]);
  try {
    console.log(
      `rot=${r} 225=${JSON.stringify(ee(225))} 243=${JSON.stringify(ee(243))} 269=${JSON.stringify(ee(269))} 292=${JSON.stringify(ee(292))} 303=${JSON.stringify(ee(303))} 228=${JSON.stringify(ee(228))} 262=${JSON.stringify(ee(262))}`
    );
  } catch {}
}
