// tiny-stack-vm-01: an exact interpreter for make.fun's tiny stack ISA (kit: generator/subject/ISA.md),
// matching the reference VM (generator/subject/vm.mjs) rule for rule, in its check order. Per instance it
// reads MAKEFUN_INPUT_DIR/<id>/{program.bin,input.bin} and writes MAKEFUN_OUTPUT_DIR/<id>/{stdout.bin,exit.txt}.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Values popped per opcode, by opcode byte; unnamed bytes are rejected before this is read.
// Only PUSH8, PUSH32, DUP, OVER and IN can grow the stack past 256.
const POPS = '000112230000000022222221222122202220000000000000011000000000000012000000000000001101';

function run(p, inp) {
  const n = p.length;
  const D = new Int32Array(256); // data stack
  const C = new Int32Array(64); // call stack
  const M = new Int32Array(256); // memory, zero-filled
  const out = new Uint8Array(65536);
  let sp = 0, csp = 0, olen = 0, ip = 0, pc = 0, steps = 0;
  const done = (code) => ({ out: out.slice(0, olen), code });
  for (;;) {
    if (steps === 1000000) return done(10); // step limit
    if (pc < 0 || pc >= n) return done(9); // pc outside the program
    const op = p[pc];
    const imm = op === 1 ? 1 : op === 2 ? 4 : op >= 0x30 && op <= 0x33 ? 2 : 0;
    const known =
      op <= 7 || (op >= 0x10 && op <= 0x1e) || (op >= 0x20 && op <= 0x22) ||
      (op >= 0x30 && op <= 0x34) || op === 0x40 || op === 0x41 || (op >= 0x50 && op <= 0x53);
    if (!known) return done(5); // unknown opcode (0x1f is not one)
    if (pc + imm >= n) return done(9); // immediate cut off by the program's end
    steps++;
    if (sp < POPS.charCodeAt(op) - 48) return done(2); // stack underflow
    if (sp === 256 && (op === 1 || op === 2 || op === 4 || op === 6 || op === 0x52)) return done(3); // stack overflow
    const next = pc + 1 + imm;
    pc = next;
    switch (op) {
      case 0x00: // HALT
        return done(0);
      case 0x01: // PUSH8: the byte sign-extended (0xff is -1)
        D[sp++] = (p[next - 1] << 24) >> 24;
        break;
      case 0x02: // PUSH32: four bytes, little-endian, signed
        D[sp++] = p[next - 4] | (p[next - 3] << 8) | (p[next - 2] << 16) | (p[next - 1] << 24);
        break;
      case 0x03: // POP
        sp--;
        break;
      case 0x04: // DUP
        D[sp] = D[sp - 1];
        sp++;
        break;
      case 0x05: { // SWAP
        const t = D[sp - 1];
        D[sp - 1] = D[sp - 2];
        D[sp - 2] = t;
        break;
      }
      case 0x06: // OVER
        D[sp] = D[sp - 2];
        sp++;
        break;
      case 0x07: { // ROT: ( a b c -- b c a )
        const a = D[sp - 3];
        D[sp - 3] = D[sp - 2];
        D[sp - 2] = D[sp - 1];
        D[sp - 1] = a;
        break;
      }
      case 0x17: // NEG (wraps at -2147483648)
        D[sp - 1] = -D[sp - 1] | 0;
        break;
      case 0x1b: // NOT
        D[sp - 1] = ~D[sp - 1];
        break;
      case 0x30: // JMP: pc = next + signed offset
        pc = next + (((p[next - 2] | (p[next - 1] << 8)) << 16) >> 16);
        break;
      case 0x31: // JZ
      case 0x32: { // JNZ
        const v = D[--sp];
        if ((op === 0x31) === (v === 0)) pc = next + (((p[next - 2] | (p[next - 1] << 8)) << 16) >> 16);
        break;
      }
      case 0x33: // CALL: the immediate is an unsigned absolute address
        if (csp === 64) return done(7);
        C[csp++] = next;
        pc = p[next - 2] | (p[next - 1] << 8);
        break;
      case 0x34: // RET
        if (csp === 0) return done(8);
        pc = C[--csp];
        break;
      case 0x40: // LOAD
        if (D[sp - 1] < 0 || D[sp - 1] > 255) return done(6);
        D[sp - 1] = M[D[sp - 1]];
        break;
      case 0x41: // STORE: ( v addr -- )
        if (D[sp - 1] < 0 || D[sp - 1] > 255) return done(6);
        M[D[sp - 1]] = D[sp - 2];
        sp -= 2;
        break;
      case 0x50: { // PRINT: decimal ASCII; over the output limit it writes nothing
        const s = String(D[sp - 1]);
        if (olen + s.length > 65536) return done(11);
        sp--;
        for (let i = 0; i < s.length; i++) out[olen++] = s.charCodeAt(i);
        break;
      }
      case 0x51: // PUTC: one byte, v AND 255
        if (olen + 1 > 65536) return done(11);
        out[olen++] = D[--sp] & 255;
        break;
      case 0x52: // IN: the next input byte, -1 once the input is used up
        D[sp++] = ip < inp.length ? inp[ip++] : -1;
        break;
      case 0x53: // EXIT: code v AND 255 (so -1 exits 255)
        return done(D[--sp] & 255);
      default: { // the binary operators: ( a b -- r )
        const b = D[sp - 1];
        const a = D[sp - 2];
        let r;
        switch (op) {
          case 0x10: r = (a + b) | 0; break;
          case 0x11: r = (a - b) | 0; break;
          case 0x12: r = Math.imul(a, b); break; // MUL: the low 32 bits of the exact product
          case 0x13: // DIV: truncated toward zero (-2147483648 / -1 stays -2147483648)
            if (b === 0) return done(4);
            r = a === -2147483648 && b === -1 ? a : (a / b) | 0;
            break;
          case 0x14: // MOD: the sign of a; x % -1 is 0
            if (b === 0) return done(4);
            r = b === -1 ? 0 : a % b | 0;
            break;
          case 0x15: // DIVU: a and b read as unsigned
            if (b === 0) return done(4);
            r = Math.floor((a >>> 0) / (b >>> 0)) | 0;
            break;
          case 0x16: // MODU
            if (b === 0) return done(4);
            r = (a >>> 0) % (b >>> 0) | 0;
            break;
          case 0x18: r = a & b; break;
          case 0x19: r = a | b; break;
          case 0x1a: r = a ^ b; break;
          case 0x1c: r = a << (b & 31); break; // shift counts use only the low 5 bits
          case 0x1d: r = a >> (b & 31); break; // SHR: arithmetic
          case 0x1e: r = (a >>> (b & 31)) | 0; break; // SHRU: logical
          case 0x20: r = a === b ? 1 : 0; break;
          case 0x21: r = a < b ? 1 : 0; break; // LT: signed
          default: r = (a >>> 0) < (b >>> 0) ? 1 : 0; break; // 0x22 LTU: unsigned
        }
        sp--;
        D[sp - 1] = r;
        break;
      }
    }
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  const r = run(new Uint8Array(readFileSync(join(I, id, 'program.bin'))), new Uint8Array(readFileSync(join(I, id, 'input.bin'))));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), r.out);
  writeFileSync(join(O, id, 'exit.txt'), `${r.code}\n`);
}
