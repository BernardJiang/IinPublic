covers: SPEC-5.1, SPEC-5.2, SPEC-5.4, SPEC-13.6

# Dialog responsiveness with the hub stalled

With hub requests stalled, the suite opens each major dialog and sweeps its safe controls. Every
control must produce a visible reaction within one second without a one-second main-thread stall;
destructive actions and targeted submit paths remain outside this sweep.
