/* ============ Modo demonstração ============ */
// Um ELM327 de mentira, ligado a um motor simulado (CAN 11 bit 500k). Responde aos mesmos
// comandos que o adaptador real, então todo o app (protocolo, painel, sondas) é exercitado.
function connectDemo(){
  let cb = () => {}, alive = true;
  const t0 = performance.now();
  let last = t0, phase = 0, postV = 0.68, temp = 38;
  const SUP = [0x01, 0x03, 0x04, 0x05, 0x06, 0x07, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F, 0x11, 0x13, 0x14, 0x15, 0x1C, 0x1F, 0x20,
    0x21, 0x2F, 0x33, 0x40, 0x42, 0x46, 0x51];
  const bitmap = base => { let b = 0; for (const p of SUP) if (p > base && p <= base + 32) b |= 1 << (32 - (p - base)); return (b >>> 0).toString(16).toUpperCase().padStart(8, '0'); };
  const VIN = '935FCKFVZAB123456';
  const rnd = a => (Math.random() * 2 - 1) * a;

  // Ciclo de 90 s: lenta, acelera, cruzeiro, desacelera (corte), lenta
  function car(){
    const now = performance.now(), dt = (now - last) / 1000, t = (now - t0) / 1000; last = now;
    const c = t % 90;
    let spd = 0, mode = 'idle';
    if (c >= 25 && c < 45){ spd = (c - 25) * 3; mode = 'accel'; }
    else if (c >= 45 && c < 65){ spd = 60 + 2 * Math.sin(c); mode = 'cruise'; }
    else if (c >= 65 && c < 80){ spd = 60 - (c - 65) * 4; mode = 'decel'; }
    temp += (92 - temp) * Math.min(1, dt / 50);
    const rpm = mode === 'idle' ? 820 + rnd(15) : mode === 'decel' ? 850 + spd * 20 : 850 + spd * 21 + (mode === 'accel' ? 450 : 0) + rnd(10);
    const map = { idle: 33, accel: 68, cruise: 44, decel: 21 }[mode] + rnd(1.5);
    const closed = temp > 70 && mode !== 'decel';
    phase += dt * 2 * Math.PI * (mode === 'idle' ? 0.6 : 1.1);
    let pre;
    if (mode === 'decel') pre = 0.06 + rnd(0.02);
    else if (!closed) pre = temp < 50 ? 0.45 + rnd(0.01) : 0.72 + rnd(0.05);
    else if (mode === 'accel' && c < 28) pre = 0.86 + rnd(0.02);
    else pre = 0.45 + 0.4 * Math.tanh(4 * Math.sin(phase)) + rnd(0.025);
    postV += ((mode === 'decel' ? 0.15 : 0.7) - postV) * Math.min(1, dt / (mode === 'decel' ? 3 : 8));
    const post = postV + 0.025 * Math.sin(t * 0.7) + rnd(0.008);
    return { t, mode, spd, rpm, map, temp, closed, pre: clamp(pre, 0, 1.1), post: clamp(post, 0, 1.1), stft: closed ? 4 * Math.sin(phase - Math.PI / 2) : 0 };
  }
  const hx = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).toUpperCase().padStart(2, '0');
  const hx16 = n => hx(n / 256 | 0) + hx(n % 256);
  function pidData(p, s){
    switch (p){
      case 0x00: case 0x20: case 0x40: return bitmap(p);
      case 0x01: return '00076500';
      case 0x03: return hx(s.mode === 'decel' ? 4 : s.closed ? 2 : 1) + '00';
      case 0x04: return hx(s.map * 2.55 * 0.85);
      case 0x05: return hx(s.temp + 40);
      case 0x06: return hx(128 + s.stft * 1.28);
      case 0x07: return hx(128 + 3.1 * 1.28);
      case 0x0B: return hx(s.map);
      case 0x0C: return hx16(s.rpm * 4);
      case 0x0D: return hx(s.spd);
      case 0x0E: return hx(({ idle: 10, accel: 16, cruise: 26, decel: 30 }[s.mode] + rnd(1) + 64) * 2);
      case 0x0F: return hx(32 + 40);
      case 0x11: return hx(({ idle: 14, accel: 40, cruise: 22, decel: 14 }[s.mode]) * 2.55);
      case 0x13: return '03';
      case 0x14: return hx(s.pre * 200) + hx(128 + s.stft * 1.28);
      case 0x15: return hx(s.post * 200) + 'FF';
      case 0x1C: return hx(29);
      case 0x1F: return hx16(s.t);
      case 0x21: return '0000';
      case 0x2F: return hx(62 * 2.55);
      case 0x33: return hx(95);
      case 0x42: return hx16(14100 + rnd(60));
      case 0x46: return hx(28 + 40);
      case 0x51: return hx(9);
    }
    return null;
  }
  // Monta a resposta CAN: um quadro até 7 bytes; acima disso, quadros numerados "0:", "1:"...
  function canLines(hex){
    const n = hex.length / 2;
    if (n <= 7) return [hex];
    const lines = [n.toString(16).toUpperCase().padStart(3, '0')];
    lines.push('0:' + hex.slice(0, 12));
    for (let i = 12, k = 1; i < hex.length; i += 14, k++) lines.push((k % 16).toString(16).toUpperCase() + ':' + hex.slice(i, i + 14).padEnd(14, '0'));
    return lines;
  }
  function answer(c){
    c = c.replace(/\s/g, '').toUpperCase();
    if (c === 'ATZ') return ['', 'ELM327 v1.5'];
    if (c === 'ATI') return ['ELM327 v1.5'];
    if (c === 'AT@1') return ['OBDII to RS232 Interpreter (DEMO)'];
    if (c === 'AT@2' || c === 'STI' || c.startsWith('ATPB')) return ['?'];
    if (c === 'ATRV') return [(13.95 + rnd(0.05)).toFixed(1) + 'V'];
    if (c === 'ATDPN') return ['A6'];
    if (c === 'ATDP') return ['AUTO, ISO 15765-4 (CAN 11/500)'];
    if (c.startsWith('AT')) return ['OK'];
    if (c === '03') return ['4300'];
    if (c === '07') return ['4700'];
    if (c === '04') return ['44'];
    if (c === '0902'){
      const hex = '490201' + [...VIN].map(ch => ch.charCodeAt(0).toString(16).toUpperCase()).join('');
      return canLines(hex);
    }
    if (c === '0904') return ['490401' + [...'DEMO-CAL-0001'].map(ch => ch.charCodeAt(0).toString(16).toUpperCase()).join('')];
    if (c === '090A') return ['490A01' + [...'ECM-EngineCtl'].map(ch => ch.charCodeAt(0).toString(16).toUpperCase()).join('')];
    if (/^01([0-9A-F]{2}){1,6}$/.test(c)){
      const s = car(), ps = c.slice(2).match(/../g).map(x => parseInt(x, 16));
      let hex = '41';
      for (const p of ps){ const d = pidData(p, s); if (d != null) hex += hx(p) + d; }
      return hex === '41' ? ['NO DATA'] : canLines(hex);
    }
    return ['NO DATA'];
  }
  return {
    kind: 'Demo', name: 'Simulador', meta: { 'Observação': 'Dados simulados, sem carro de verdade' }, gatt: null,
    onData: f => cb = f,
    async send(str){
      const c = str.trim(), npid = c.startsWith('01') ? (c.length - 2) / 2 : 1;
      const lines = answer(c);
      // Latência típica de um clone BLE em CAN
      setTimeout(() => { if (alive) cb(lines.join('\r') + '\r\r>'); }, 38 + 9 * npid + Math.random() * 12);
    },
    close(){ alive = false; }
  };
}
