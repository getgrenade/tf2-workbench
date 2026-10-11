/** The web build's stand-in for `@tauri-apps/api/event`: nothing sends events here (they came from the desktop shell). */
export async function listen<T>(_event: string, _handler: (e: { payload: T }) => void): Promise<() => void> {
  return () => {};
}
