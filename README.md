# tiny-stack-vm-01 — entry

`main.ts` is an exact interpreter for make.fun's tiny stack ISA (kit:
`generator/subject/ISA.md`), matching the reference VM rule for rule.
Node 22: `MAKEFUN_INPUT_DIR=<instances> MAKEFUN_OUTPUT_DIR=<out> node main.ts`
writes `<out>/<id>/stdout.bin` and `<out>/<id>/exit.txt` per instance.
