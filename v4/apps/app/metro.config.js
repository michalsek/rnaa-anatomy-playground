// Adapted from BoneTideOSS (MIT, Konrad Reczko): workspace watch folders and the `#platform`
// seam. One Expo app serves web and native, so the remap picks a host folder per platform.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

const workspaceRoot = path.resolve(__dirname, '../..');
config.watchFolders = [workspaceRoot];
config.resolver.unstable_enableSymlinks = true;
config.resolver.nodeModulesPaths = [
  path.join(__dirname, 'node_modules'),
  path.join(workspaceRoot, 'node_modules'),
];

const prevResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('#platform/')) {
    const host = platform === 'web' ? 'web' : 'native';
    return {
      type: 'sourceFile',
      filePath: path.join(__dirname, 'src/platform', host, moduleName.slice('#platform/'.length)),
    };
  }
  return (prevResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
