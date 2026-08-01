export async function syncWechatConnectionAfterLogin(onConnected: () => Promise<void>) {
  try {
    await onConnected();
    return true;
  } catch {
    return false;
  }
}
