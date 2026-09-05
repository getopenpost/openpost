import * as SecureStore from "expo-secure-store";

const CELLULAR_UPLOAD_KEY = "openpost.video-projects.allow-cellular.v1";

export async function getAllowCellularVideoUploads(): Promise<boolean> {
  return (await SecureStore.getItemAsync(CELLULAR_UPLOAD_KEY)) === "true";
}

export async function setAllowCellularVideoUploads(value: boolean): Promise<void> {
  await SecureStore.setItemAsync(CELLULAR_UPLOAD_KEY, String(value));
}
