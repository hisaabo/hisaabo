// runInThread fixture: a synchronous busy loop, like a catastrophic regex.
export default function spin() {
  for (;;) { /* never returns */ }
}
