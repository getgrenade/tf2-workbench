/** The marker of the files the app writes (scenes, poses, lights, post-processing), and the one the first versions of the app used. */
export const APP_ID = "tf2-workbench";
const LEGACY_APP_ID = "loadout-locker";

/** Whether a file's `app` field says it is ours (files from before the rename still open). */
export const isAppFile = (app: unknown): boolean => app === APP_ID || app === LEGACY_APP_ID;

/** The kinds of a saved light setup, the old one included. */
export const LIGHT_SETUP_KIND = "tf2-workbench-light-setup";
export const isLightSetupKind = (kind: unknown): boolean => kind === LIGHT_SETUP_KIND || kind === "loadout-locker-light-setup";
