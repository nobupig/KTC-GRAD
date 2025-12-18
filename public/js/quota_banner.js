const CHEVRON_QUOTA_BANNER_ID = 'quota-exceeded-banner';
const QUOTA_BANNER_MESSAGE = '本日のアクセス上限に達しました。時間をおいて再度お試しください。';

function ensureBannerElement(message) {
  let banner = document.getElementById(CHEVRON_QUOTA_BANNER_ID);
  if (!banner) {
    banner = document.createElement('div');
    banner.id = CHEVRON_QUOTA_BANNER_ID;
    banner.className = 'quota-error-banner';
    banner.style.position = 'fixed';
    banner.style.top = '0';
    banner.style.left = '0';
    banner.style.right = '0';
    banner.style.background = '#b00020';
    banner.style.color = '#fff';
    banner.style.padding = '10px';
    banner.style.textAlign = 'center';
    banner.style.zIndex = '9999';
    banner.style.fontWeight = 'bold';
    banner.style.fontSize = '1.1em';
    document.body.appendChild(banner);
  }
  banner.textContent = message;
  banner.style.display = '';
  return banner;
}

function disableAllGradeInputs() {
  const selectors = 'input,button,textarea,select';
  document.querySelectorAll(selectors).forEach((el) => {
    el.disabled = true;
  });
}

export function showQuotaBanner(message) {
  ensureBannerElement(message);
}

export function hideQuotaBanner() {
  const banner = document.getElementById(CHEVRON_QUOTA_BANNER_ID);
  if (banner) {
    banner.style.display = 'none';
  }
}

export function activateQuotaErrorState(useMessage) {
  const message = useMessage || QUOTA_BANNER_MESSAGE;
  ensureBannerElement(message);
  disableAllGradeInputs();
}
