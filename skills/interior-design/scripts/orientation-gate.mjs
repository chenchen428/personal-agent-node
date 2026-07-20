const SESSION_KEY = 'interior-design:allow-portrait';

export function startOrientationGate({ onViewportChange = () => {} } = {}) {
  const gate = document.querySelector('#orientation-gate');
  const shell = document.querySelector('#viewer-shell');
  const requestButton = document.querySelector('#request-landscape');
  const continueButton = document.querySelector('#continue-portrait');
  const status = document.querySelector('#orientation-status');
  const portrait = matchMedia('(orientation: portrait)');
  const phone = matchMedia('(max-width: 760px)');
  let wasVisible = false;
  let previousFocus = null;

  const allowed = () => sessionStorage.getItem(SESSION_KEY) === '1';
  const visible = () => portrait.matches && phone.matches && !allowed();
  const sync = () => {
    const show = visible();
    gate.hidden = !show;
    gate.setAttribute('aria-hidden', String(!show));
    shell.toggleAttribute('inert', show);
    shell.setAttribute('aria-hidden', String(show));
    document.body.classList.toggle('orientation-blocked', show);
    document.body.classList.toggle('portrait-allowed', portrait.matches && allowed());
    if (show && !wasVisible) { previousFocus = document.activeElement; requestAnimationFrame(() => requestButton.focus()); }
    if (!show && wasVisible && previousFocus instanceof HTMLElement && document.contains(previousFocus)) previousFocus.focus();
    wasVisible = show;
    requestAnimationFrame(onViewportChange);
  };
  const continuePortrait = () => { sessionStorage.setItem(SESSION_KEY, '1'); status.textContent = ''; sync(); };
  const requestLandscape = async () => {
    status.textContent = '';
    try {
      if (!screen.orientation?.lock) throw new Error('unsupported');
      await screen.orientation.lock('landscape');
      status.textContent = '已请求横屏，正在调整视图。';
    } catch {
      status.textContent = '设备未允许锁定，请手动旋转手机；也可继续竖屏查看。';
    }
    sync();
  };
  const trapFocus = (event) => {
    if (gate.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); continuePortrait(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [requestButton, continueButton];
    const first = focusable[0]; const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  requestButton.addEventListener('click', requestLandscape);
  continueButton.addEventListener('click', continuePortrait);
  gate.addEventListener('keydown', trapFocus);
  portrait.addEventListener?.('change', sync);
  phone.addEventListener?.('change', sync);
  window.addEventListener('resize', sync);
  window.addEventListener('orientationchange', sync);
  sync();
  return { sync, isVisible: () => !gate.hidden, continuePortrait };
}
