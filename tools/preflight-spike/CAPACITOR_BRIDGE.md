# Capacitor serial bridge (Track 2): prototype notes, not adopted

**Scope (owner decision 2026-11-16):** a transport-only prototype inside the Phase 1 spike boundary. Adopting a native wrapper, a build pipeline or a distribution path needs a separate architecture and owner decision. Nothing here is built, and no Capacitor dependency is added to the repository.

**Interface.** A bridge implements the same surface as `src/preflight/transport.js`: `open()`, `close()`, `onData(cb)`, `onClose(cb)`, and a `write(bytes)` that goes through `Transport.write`, so the read-only rule (`isAllowedRequestFrame`) still applies. Serial open, read, write and close only. No motor, CLI, DFU or 4-way logic belongs in the plugin.

**Library.** `mik3y/usb-serial-for-android` (MIT; CDC-ACM detection since 3.5.0) behind a small Capacitor plugin. Betaflight App precedent (PRs 4698 and 4706): after the user accepts the permission dialog the port can fail to appear until a replug or a manual find. Design input: the plugin must re-run device discovery after the permission result.

**Questions the prototype must answer on real phones (M8):** does the port list after permission; permission grant persistence after reload and re-attach; behaviour on FC reboot and DFU re-enumeration; whether the connection survives notification shade, screen lock, app switch and swipe-away; timer drift and latency while hidden; power draw and whether USB-C to USB-C cables power the FC; throughput at 115200 baud and above.

**Status:** not started. Track 1 (native Web Serial) comes first; see `lab.js`.
