const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Fix for @noble/hashes exports resolution
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
