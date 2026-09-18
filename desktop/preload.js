const { contextBridge } = require("electron");
contextBridge.exposeInMainWorld("civilAI", { desktop: true, platform: process.platform, version: process.env.npm_package_version || "0.1.0" });
