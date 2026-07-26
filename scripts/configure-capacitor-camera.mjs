import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const frontendRoot = resolve(import.meta.dirname, "..", "frontend");
const androidManifest = resolve(
  frontendRoot,
  "android",
  "app",
  "src",
  "main",
  "AndroidManifest.xml",
);
const iosInfoPlist = resolve(frontendRoot, "ios", "App", "App", "Info.plist");

if (existsSync(androidManifest)) {
  const manifest = readFileSync(androidManifest, "utf8");
  if (!manifest.includes("android.permission.CAMERA")) {
    const updated = manifest.replace(
      /(\s*)<application\b/,
      '$1<uses-permission android:name="android.permission.CAMERA" />$1<application',
    );
    if (updated === manifest)
      throw new Error("Could not add the Android camera permission.");
    writeFileSync(androidManifest, updated);
  }
}

if (existsSync(iosInfoPlist)) {
  const plist = readFileSync(iosInfoPlist, "utf8");
  if (!plist.includes("<key>NSCameraUsageDescription</key>")) {
    const updated = plist.replace(
      "</dict>",
      "\t<key>NSCameraUsageDescription</key>\n\t<string>OpenPost uses the camera when you choose to take a photo for your media library.</string>\n</dict>",
    );
    if (updated === plist)
      throw new Error("Could not add the iOS camera usage description.");
    writeFileSync(iosInfoPlist, updated);
  }
}
