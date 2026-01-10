/**
 * Background service worker
 * Handles message relay between popup and content script
 */

// Relay messages to content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startSync' && message.tabId) {
    chrome.tabs.sendMessage(message.tabId, { action: 'startSync' })
      .then(sendResponse)
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (message.action === 'cancelSync' && message.tabId) {
    chrome.tabs.sendMessage(message.tabId, { action: 'cancelSync' })
      .then(sendResponse)
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  return false;
});

// Handle extension icon click when not on ZwiftPower
chrome.action.onClicked.addListener((tab) => {
  if (!tab.url?.includes('zwiftpower.com')) {
    chrome.tabs.create({ url: 'https://zwiftpower.com' });
  }
});
