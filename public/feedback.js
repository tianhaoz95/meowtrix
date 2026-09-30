// FeedbackKit in-app feedback (screenshot + annotate + describe → FeedbackKit dashboard).
// Loaded before every other app script so console errors from startup are captured too.
// The only trigger is ⌘⇧F / Ctrl+Shift+F, dispatched through runAppShortcut (app.js) → openFeedback().
// FeedbackKit's own enableKeyboardShortcut() is left off so the key isn't handled twice.

const FEEDBACK_FALLBACK_URL = 'https://github.com/tianhaoz95/meowtrix/issues/new';

(function initFeedbackKit() {
  const FK = window.FeedbackKit;
  if (!FK) return;
  try {
    const version = window.MEOWTRIX_VERSION || undefined;
    FK.configure({
      projectKey: 'pk_a2157c1fc7c01f948094c73935cf997f5c0e',
      endpoint: 'https://gpucoladcyvijefdjudf.supabase.co/functions/v1/ingest-feedback',
      appVersion: version,
      appBuild: version,
    });
    FK.theme = { primaryColorHex: '#8b5cf6' };
    FK.currentScreen = 'Workspace';
    FK.enableFixVerification();
  } catch (err) {
    console.warn('[feedback] FeedbackKit init failed:', err);
  }
})();

function openFeedback() {
  const FK = window.FeedbackKit;
  if (!FK || !FK.isConfigured) {
    window.open(FEEDBACK_FALLBACK_URL, '_blank');
    return;
  }
  const tab = typeof activePane !== 'undefined' ? activePane?.activeTab : null;
  FK.currentScreen = tab?.type ? `Workspace · ${tab.type}` : 'Workspace';
  FK.presentAndSubmit().catch(err => console.warn('[feedback] submit failed:', err));
}
