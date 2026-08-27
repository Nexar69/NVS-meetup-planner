(() => {
  const STORAGE_KEY = "meet-schwerin-test-lab-v012";

  function realDateConstructor() {
    const current = window.Date;
    const parent = Object.getPrototypeOf(current);
    return parent && parent !== Function.prototype ? parent : current;
  }

  function installInstanceGuard() {
    const TestDate = window.Date;
    const RealDate = realDateConstructor();
    if (!TestDate || TestDate === RealDate || TestDate.__nvsTestInstanceGuard) return;
    try {
      Object.defineProperty(TestDate, Symbol.hasInstance, {
        configurable: true,
        value(instance) {
          return instance instanceof RealDate;
        },
      });
      Object.defineProperty(TestDate, "__nvsTestInstanceGuard", { value: true });
    } catch {}
  }

  function persistCorrectedState(realNow) {
    try {
      const snapshot = window.NVSTestLab?.getState?.();
      if (!snapshot) return;
      const now = Number(snapshot.now);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        ...snapshot,
        virtualMs: Number.isFinite(now) ? now : realNow,
        savedAt: realNow,
      }));
    } catch {}
  }

  window.addEventListener("nvs-test-state-change", (event) => {
    if (!event.detail?.enabled) return;
    installInstanceGuard();
    const RealDate = realDateConstructor();
    const realNow = RealDate.now();
    const virtualNow = Number(event.detail.now);
    const memberStates = event.detail.memberStates;
    if (!memberStates || !Number.isFinite(virtualNow)) return;

    let corrected = false;
    Object.values(memberStates).forEach((entry) => {
      const at = Number(entry?.at);
      if (!Number.isFinite(at)) return;
      if (Math.abs(at - realNow) <= 10000) {
        entry.at = virtualNow;
        corrected = true;
      }
    });
    if (corrected) persistCorrectedState(realNow);
  });

  installInstanceGuard();
})();
