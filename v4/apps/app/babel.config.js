// Adapted from BoneTideOSS (MIT, Konrad Reczko).
module.exports = (api) => {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Turns 'use gpu' functions into ASTs TypeGPU compiles to WGSL at runtime.
    plugins: ['unplugin-typegpu/babel'],
  };
};
